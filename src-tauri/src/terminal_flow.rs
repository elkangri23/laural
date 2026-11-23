use std::sync::{Condvar, Mutex};

pub(crate) const TERMINAL_OUTPUT_WINDOW_BYTES: usize = 256 * 1024;

#[derive(Default)]
pub(crate) struct TerminalOutputFlow {
    state: Mutex<FlowState>,
    available: Condvar,
}

#[derive(Default)]
struct FlowState {
    pending_bytes: usize,
    closed: bool,
}

impl TerminalOutputFlow {
    pub(crate) fn reserve(&self, bytes: usize) -> bool {
        if bytes == 0 || bytes > TERMINAL_OUTPUT_WINDOW_BYTES {
            return false;
        }

        let mut state = self.state.lock().unwrap_or_else(|error| error.into_inner());
        while !state.closed && state.pending_bytes + bytes > TERMINAL_OUTPUT_WINDOW_BYTES {
            state = self
                .available
                .wait(state)
                .unwrap_or_else(|error| error.into_inner());
        }
        if state.closed {
            return false;
        }
        state.pending_bytes += bytes;
        true
    }

    pub(crate) fn acknowledge(&self, bytes: usize) -> bool {
        let mut state = self.state.lock().unwrap_or_else(|error| error.into_inner());
        if state.closed || bytes == 0 || bytes > state.pending_bytes {
            return false;
        }
        state.pending_bytes -= bytes;
        self.available.notify_one();
        true
    }

    pub(crate) fn close(&self) {
        let mut state = self.state.lock().unwrap_or_else(|error| error.into_inner());
        state.closed = true;
        state.pending_bytes = 0;
        self.available.notify_all();
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::{
        sync::{Arc, mpsc},
        thread,
        time::Duration,
    };

    #[test]
    fn la_confirmacion_libera_capacidad_para_el_lector() {
        let flow = Arc::new(TerminalOutputFlow::default());
        assert!(flow.reserve(TERMINAL_OUTPUT_WINDOW_BYTES));

        let reader_flow = Arc::clone(&flow);
        let (started, waiting) = mpsc::channel();
        let reader = thread::spawn(move || {
            started.send(()).unwrap();
            reader_flow.reserve(1)
        });
        waiting.recv_timeout(Duration::from_secs(1)).unwrap();
        assert!(!reader.is_finished());
        thread::sleep(Duration::from_millis(20));
        assert!(!reader.is_finished());
        assert!(flow.acknowledge(TERMINAL_OUTPUT_WINDOW_BYTES));

        assert!(reader.join().unwrap());
        assert!(flow.acknowledge(1));
    }

    #[test]
    fn rechaza_confirmaciones_nulas_excesivas_y_reservas_fuera_de_limite() {
        let flow = TerminalOutputFlow::default();
        assert!(!flow.reserve(0));
        assert!(!flow.reserve(TERMINAL_OUTPUT_WINDOW_BYTES + 1));
        assert!(flow.reserve(5));
        assert!(!flow.acknowledge(0));
        assert!(!flow.acknowledge(6));
        assert!(flow.acknowledge(5));
    }

    #[test]
    fn el_cierre_despierta_al_lector_que_espera_creditos() {
        let flow = Arc::new(TerminalOutputFlow::default());
        assert!(flow.reserve(TERMINAL_OUTPUT_WINDOW_BYTES));
        let reader_flow = Arc::clone(&flow);
        let (started, waiting) = mpsc::channel();
        let reader = thread::spawn(move || {
            started.send(()).unwrap();
            reader_flow.reserve(1)
        });
        waiting.recv_timeout(Duration::from_secs(1)).unwrap();
        thread::sleep(Duration::from_millis(20));
        assert!(!reader.is_finished());
        flow.close();

        assert!(!reader.join().unwrap());
        assert!(!flow.reserve(1));
        assert!(!flow.acknowledge(1));
    }
}
