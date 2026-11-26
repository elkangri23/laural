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

        let mut state = recover_poisoned(self.state.lock());
        while !state.closed && state.pending_bytes + bytes > TERMINAL_OUTPUT_WINDOW_BYTES {
            state = recover_poisoned(self.available.wait(state));
        }
        if state.closed {
            return false;
        }
        state.pending_bytes += bytes;
        true
    }

    pub(crate) fn acknowledge(&self, bytes: usize) -> bool {
        let mut state = recover_poisoned(self.state.lock());
        if state.closed || bytes == 0 || bytes > state.pending_bytes {
            return false;
        }
        state.pending_bytes -= bytes;
        self.available.notify_one();
        true
    }

    pub(crate) fn close(&self) {
        let mut state = recover_poisoned(self.state.lock());
        state.closed = true;
        state.pending_bytes = 0;
        self.available.notify_all();
    }
}

fn recover_poisoned<T>(result: std::sync::LockResult<T>) -> T {
    result.unwrap_or_else(|error| error.into_inner())
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
    fn libera_solo_los_bytes_confirmados_y_respeta_el_limite() {
        let flow = TerminalOutputFlow::default();
        assert!(flow.reserve(10));
        assert!(flow.acknowledge(4));
        assert!(flow.reserve(TERMINAL_OUTPUT_WINDOW_BYTES - 6));
        assert!(flow.acknowledge(TERMINAL_OUTPUT_WINDOW_BYTES));
        assert!(!flow.acknowledge(1));
    }

    #[test]
    fn recupera_el_valor_de_un_mutex_envenenado() {
        let mutex = Arc::new(Mutex::new(42));
        let poisoned_mutex = Arc::clone(&mutex);
        assert!(
            thread::spawn(move || {
                let _guard = poisoned_mutex.lock().unwrap();
                panic!("envenenamiento aislado de prueba");
            })
            .join()
            .is_err()
        );

        assert_eq!(*recover_poisoned(mutex.lock()), 42);
    }

    #[test]
    fn recupera_el_flujo_si_una_panica_envenena_el_estado_compartido() {
        let flow = Arc::new(TerminalOutputFlow::default());
        let poisoned_flow = Arc::clone(&flow);
        let panic = thread::spawn(move || {
            let _state = poisoned_flow.state.lock().unwrap();
            panic!("fallo simulado mientras se conserva el estado del flujo");
        })
        .join();

        assert!(panic.is_err());
        assert!(flow.reserve(5));
        assert!(flow.acknowledge(5));
        flow.close();
        assert!(!flow.reserve(1));
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
