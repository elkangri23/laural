use base64::{Engine as _, engine::general_purpose::STANDARD};
use serde::Serialize;

#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct TerminalOutput {
    data_base64: String,
}

impl TerminalOutput {
    pub(crate) fn from_bytes(data: &[u8]) -> Self {
        Self {
            data_base64: STANDARD.encode(data),
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use base64::engine::general_purpose::STANDARD;

    #[test]
    fn serializa_salida_pty_en_base64_y_se_puede_recuperar_sin_perdida() {
        let bytes: Vec<u8> = (0..=u8::MAX).cycle().take(32 * 1024).collect();
        let event = TerminalOutput::from_bytes(&bytes);
        let value = serde_json::to_value(event).unwrap();
        let encoded = value["dataBase64"].as_str().unwrap();

        assert_eq!(STANDARD.decode(encoded).unwrap(), bytes);
    }

    #[test]
    fn usa_menos_bytes_que_el_array_json_de_numeros() {
        let bytes: Vec<u8> = (0..=u8::MAX).cycle().take(32 * 1024).collect();
        let array_json = serde_json::to_vec(&bytes).unwrap();
        let base64_json = serde_json::to_vec(&TerminalOutput::from_bytes(&bytes)).unwrap();

        assert!(base64_json.len() * 2 < array_json.len());
    }
}
