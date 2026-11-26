use serde_json::Value;

const MAX_EVENT: usize = 2_000_000;
const MAX_TEXT: usize = 2_000_000;

#[derive(Default)]
pub(crate) struct ChatStream {
    line: Vec<u8>,
    data: String,
    text_bytes: usize,
    finished_choice: bool,
}

impl ChatStream {
    // Keep bytes until the entire line arrives: a transport chunk can split a UTF-8 character.
    pub(crate) fn push(
        &mut self,
        bytes: &[u8],
        emit: &mut impl FnMut(&str) -> Result<(), String>,
    ) -> Result<bool, String> {
        for part in bytes.split_inclusive(|b| *b == b'\n') {
            if self.line.len() + self.data.len() + part.len() > MAX_EVENT {
                return Err("El evento del proveedor supera el límite de 2 MB.".into());
            }
            self.line.extend_from_slice(part);
            if part.ends_with(b"\n") && self.end_line(emit)? {
                return Ok(true);
            }
        }
        Ok(false)
    }

    fn end_line(
        &mut self,
        emit: &mut impl FnMut(&str) -> Result<(), String>,
    ) -> Result<bool, String> {
        let line = std::str::from_utf8(&self.line)
            .map_err(|_| "El proveedor devolvió texto UTF-8 no válido.")?
            .trim_end_matches(['\r', '\n']);
        if line.is_empty() {
            self.line.clear();
            return self.dispatch(emit);
        }
        if let Some(data) = line.strip_prefix("data:") {
            self.data.push_str(data.strip_prefix(' ').unwrap_or(data));
            self.data.push('\n');
        }
        self.line.clear();
        Ok(false)
    }

    fn dispatch(
        &mut self,
        emit: &mut impl FnMut(&str) -> Result<(), String>,
    ) -> Result<bool, String> {
        let data = self.data.trim();
        if data == "[DONE]" {
            return self.complete();
        }
        if !data.is_empty() {
            let event: Value = serde_json::from_str(data)
                .map_err(|_| "El proveedor devolvió un evento JSON no válido.")?;
            if event.get("error").is_some_and(|e| !e.is_null()) {
                return Err("El proveedor indicó un error durante la respuesta.".into());
            }
            if let Some(text) = event
                .pointer("/choices/0/delta/content")
                .and_then(Value::as_str)
                .filter(|s| !s.is_empty())
            {
                self.text_bytes += text.len();
                if self.text_bytes > MAX_TEXT {
                    return Err("La respuesta supera el límite de 2 MB.".into());
                }
                emit(text)?;
            }
            self.finished_choice |= event
                .pointer("/choices/0/finish_reason")
                .and_then(Value::as_str)
                .is_some();
        }
        self.data.clear();
        Ok(false)
    }

    fn complete(&self) -> Result<bool, String> {
        if self.text_bytes == 0 {
            Err("El proveedor terminó sin devolver texto.".into())
        } else {
            Ok(true)
        }
    }

    pub(crate) fn eof(
        &mut self,
        emit: &mut impl FnMut(&str) -> Result<(), String>,
    ) -> Result<(), String> {
        if !self.line.is_empty() && self.end_line(emit)? {
            return Ok(());
        }
        if self.dispatch(emit)? || self.finished_choice {
            self.complete()?;
            return Ok(());
        }
        Err("La conexión terminó antes de completarse la respuesta.".into())
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn parse(parts: &[&[u8]]) -> Result<String, String> {
        let mut stream = ChatStream::default();
        let mut output = String::new();
        let mut emit = |s: &str| {
            output.push_str(s);
            Ok(())
        };
        for part in parts {
            if stream.push(part, &mut emit)? {
                return Ok(output);
            }
        }
        stream.eof(&mut emit)?;
        Ok(output)
    }

    const TEXT: &str = "data: {\"choices\":[{\"delta\":{\"content\":\"¡Sí!\"}}]}\r\n\r\n";

    #[test]
    fn preserves_text_at_every_byte_boundary() {
        let input = format!(": keepalive\n\n{TEXT}data: [DONE]");
        for at in 0..=input.len() {
            assert_eq!(
                parse(&[&input.as_bytes()[..at], &input.as_bytes()[at..]]).unwrap(),
                "¡Sí!"
            );
        }
    }

    #[test]
    fn accepts_finish_reason_at_eof_and_multiline_events() {
        let finish = b"data: {\"choices\":\ndata: [{\"finish_reason\":\"stop\"}]}";
        assert_eq!(parse(&[TEXT.as_bytes(), finish]).unwrap(), "¡Sí!");
    }

    #[test]
    fn accepts_done_when_a_carriage_return_ends_the_stream() {
        let input = format!("{TEXT}data: [DONE]\n\r");
        assert_eq!(parse(&[input.as_bytes()]).unwrap(), "¡Sí!");
    }

    #[test]
    fn accepts_done_without_final_newline_and_rejects_empty_finished_choice() {
        assert_eq!(parse(&[TEXT.as_bytes(), b"data: [DONE]"]).unwrap(), "¡Sí!");

        let empty_finished_choice = b"data: {\"choices\":[{\"finish_reason\":\"stop\"}]}";
        assert!(parse(&[empty_finished_choice]).is_err());
    }

    #[test]
    fn accepts_data_field_without_optional_space() {
        let input =
            b"data:{\"choices\":[{\"delta\":{\"content\":\"sin espacio\"}}]}\n\ndata: [DONE]\n\n";
        assert_eq!(parse(&[input]).unwrap(), "sin espacio");
    }

    #[test]
    fn stops_at_done_event_and_ignores_trailing_invalid_data() {
        let mut input = TEXT.as_bytes().to_vec();
        input.extend_from_slice(b"data: [DONE]\n\n");
        input.extend_from_slice(b"data: \xff\n");

        assert_eq!(parse(&[&input]).unwrap(), "¡Sí!");
    }

    #[test]
    fn ignores_non_data_fields_and_empty_content() {
        let input = concat!(
            ": keepalive\n",
            "id: 12\n",
            "event: message\n",
            "data:\n\n",
            "data: {\"error\":null,\"choices\":[{\"delta\":{\"content\":\"\"}}]}\n\n",
            "data: {\"choices\":[{\"delta\":{\"content\":\"válido\"}}]}\n\n",
            "data: {\"choices\":[{\"finish_reason\":\"stop\"}]}"
        );
        assert_eq!(parse(&[input.as_bytes()]).unwrap(), "válido");
    }

    #[test]
    fn propagates_consumer_failure() {
        let mut stream = ChatStream::default();
        let error = stream
            .push(TEXT.as_bytes(), &mut |_| Err("consumidor cerrado".into()))
            .unwrap_err();
        assert_eq!(error, "consumidor cerrado");
    }

    #[test]
    fn rejects_truncated_empty_or_invalid_responses() {
        for input in [
            TEXT.as_bytes(),
            b"data: [DONE]",
            b"data: {",
            b"data: {\"error\":{}}",
            b"data: \xff",
        ] {
            assert!(parse(&[input]).is_err());
        }
    }

    #[test]
    fn limits_incomplete_events_and_total_text() {
        assert!(parse(&[&vec![b'x'; MAX_EVENT + 1]]).is_err());
        let mut stream = ChatStream {
            text_bytes: MAX_TEXT,
            ..Default::default()
        };
        assert!(
            stream
                .push(TEXT.as_bytes(), &mut |_| panic!("supera el límite"))
                .is_err()
        );
    }
}
