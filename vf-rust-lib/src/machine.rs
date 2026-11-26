//! The MANDATORY exploit state-machine template. Writing an exploit rs
//! script means implementing it on this template (the Rust-side
//! counterpart of the TS "state machines by default, no exemptions" rule):
//!
//! - Declare the step sequence at the top of the script — reading the
//!   script reads the state diagram.
//! - Every step speaks the SAME outcome vocabulary as the envelope itself:
//!   `Success(data)` / `Failure(atom)` / `Data(final)`. No flow-speak like
//!   "advance" — steps produce results, the machine flows.
//! - `Success(data)` continues to the next step AND `data` becomes the
//!   state the next step receives (Probe's fingerprint flows into Craft).
//! - `Failure(atom, suggestion)` exits with the failure envelope.
//! - `Data(final)` terminates with the success envelope. Terminating
//!   before the declared Verify step is detected by the machine and
//!   recorded in the trace (`skip_verify: true`) — never silent.
//! - The standard sequence is Check -> Probe -> Craft -> Deliver -> Verify
//!   (r-msf lifecycle + pentest_rs "verify or leave a trace" ruling):
//!   Check validates option completeness — pure, zero IO.
//! - The step trace (sequence + outcome + durations) lands in the
//!   envelope's data.steps — the AgentResult carries a replay of the
//!   exploitation flow.
//! - Step closures do IO; judgment stays pure (Black Hat Rust Ch4
//!   discipline).

use std::time::Instant;

use serde_json::{json, Value};

use crate::error::Atom;

/// A step name. The standard five are provided; exploits extend as needed
/// (e.g. an Extract step for sqli chains) — the sequence is declared per
/// script, the vocabulary stays open.
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum Step {
    Check,
    Probe,
    Craft,
    Deliver,
    Verify,
    /// Custom step (e.g. "extract", "upload").
    Custom(String),
}

impl Step {
    pub fn name(&self) -> &str {
        match self {
            Step::Check => "check",
            Step::Probe => "probe",
            Step::Craft => "craft",
            Step::Deliver => "deliver",
            Step::Verify => "verify",
            Step::Custom(name) => name,
        }
    }
}

/// The step outcome — the same success/failure/data vocabulary as the
/// AgentResult envelope. One thing to learn, everywhere.
#[derive(Debug)]
pub enum Outcome {
    /// This step succeeded; `data` flows as the state into the next step.
    Success(Value),
    /// This step failed; exit now with the failure envelope. The second
    /// field is the script-declared next_suggestion (empty = the atom's
    /// internalized default).
    Failure(Atom, String),
    /// Terminal payload; exit now with the success envelope.
    Data(Value),
}

/// The declared state machine for one exploit run.
pub struct Machine {
    steps: Vec<Step>,
    trace: Vec<Value>,
}

impl Machine {
    /// Declare the step sequence (the script's state diagram).
    pub fn new(steps: Vec<Step>) -> Self {
        Self {
            steps,
            trace: Vec::new(),
        }
    }

    /// The standard five-step sequence.
    pub fn standard() -> Self {
        Self::new(vec![
            Step::Check,
            Step::Probe,
            Step::Craft,
            Step::Deliver,
            Step::Verify,
        ])
    }

    /// Drive the machine. Each step receives the state produced by the
    /// previous step's Success (initially `{}`) and returns an Outcome.
    /// Returns (ok, envelope_payload): ok=true → report::success,
    /// ok=false → report::failure with the embedded atom/suggestion.
    pub fn run<F>(&mut self, mut step_fn: F) -> (bool, Value)
    where
        F: FnMut(&Step, &Value) -> Outcome,
    {
        let mut state = json!({});
        let total = self.steps.len();
        for (index, step) in self.steps.clone().into_iter().enumerate() {
            let step_start = Instant::now();
            let outcome = step_fn(&step, &state);
            let ms = step_start.elapsed().as_millis() as u64;
            match outcome {
                Outcome::Success(data) => {
                    self.trace
                        .push(json!({"step": step.name(), "result": "success", "ms": ms}));
                    state = data;
                }
                Outcome::Failure(atom, suggestion) => {
                    self.trace
                        .push(json!({"step": step.name(), "result": "failure", "ms": ms}));
                    let suggestion = if suggestion.is_empty() {
                        atom.default_suggestion()
                    } else {
                        suggestion
                    };
                    return (
                        false,
                        json!({
                            "atom": atom.to_value(),
                            "suggestion": suggestion,
                            "data": json!({ "steps": self.trace }),
                        }),
                    );
                }
                Outcome::Data(final_data) => {
                    let skipped_verify = index + 1 < total;
                    self.trace.push(json!({
                        "step": step.name(),
                        "result": "data",
                        "ms": ms,
                        "skip_verify": skipped_verify,
                    }));
                    let mut out = final_data;
                    if let Some(obj) = out.as_object_mut() {
                        obj.insert("steps".to_string(), json!(self.trace));
                    }
                    return (true, out);
                }
            }
        }
        // Steps exhausted without a terminal outcome: the final step should
        // have returned Data (or Failure). Soft-success, never silent.
        (
            false,
            json!({
                "atom": Atom::soft_success("E_FLOW_001", "steps exhausted without a terminal Data outcome").to_value(),
                "suggestion": "the final step must return Data(..) — Success only advances",
                "data": json!({ "steps": self.trace }),
            }),
        )
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::error::Atom;

    #[test]
    fn standard_flow_data_terminates_with_trace() {
        let mut m = Machine::standard();
        let (ok, value) = m.run(|step, _state| match step {
            Step::Verify => Outcome::Data(json!({"exploited": true})),
            _ => Outcome::Success(json!({})),
        });
        assert!(ok);
        assert_eq!(value["exploited"], json!(true));
        let steps = value["steps"].as_array().unwrap();
        assert_eq!(steps.len(), 5);
        assert_eq!(steps[4]["result"], json!("data"));
        assert_eq!(steps[4]["skip_verify"], json!(false));
    }

    #[test]
    fn state_flows_between_steps() {
        let mut m = Machine::new(vec![Step::Probe, Step::Craft]);
        let (ok, value) = m.run(|step, state| match step {
            Step::Probe => Outcome::Success(json!({"fp": "nginx"})),
            Step::Craft => Outcome::Data(json!({"used": state["fp"].clone()})),
            _ => unreachable!(),
        });
        assert!(ok);
        assert_eq!(value["used"], json!("nginx"));
    }

    #[test]
    fn failure_exits_with_atom_and_trace() {
        let mut m = Machine::standard();
        let (ok, value) = m.run(|step, _| match step {
            Step::Probe => Outcome::Failure(
                Atom::net_unreachable("E_NET_001", "no route"),
                String::new(),
            ),
            _ => Outcome::Success(json!({})),
        });
        assert!(!ok);
        assert_eq!(value["atom"]["kind"], json!("net_unreachable"));
        assert!(value["suggestion"]
            .as_str()
            .unwrap()
            .contains("reachability"));
        assert_eq!(value["data"]["steps"].as_array().unwrap().len(), 2);
    }

    #[test]
    fn early_data_marks_skip_verify() {
        let mut m = Machine::standard();
        let (ok, value) = m.run(|step, _| match step {
            Step::Craft => Outcome::Data(json!({"early": true})),
            _ => Outcome::Success(json!({})),
        });
        assert!(ok);
        let steps = value["steps"].as_array().unwrap();
        assert_eq!(steps[2]["skip_verify"], json!(true));
    }

    #[test]
    fn exhaustion_without_data_is_soft_failure() {
        let mut m = Machine::new(vec![Step::Check]);
        let (ok, value) = m.run(|_, _| Outcome::Success(json!({})));
        assert!(!ok);
        assert_eq!(value["atom"]["kind"], json!("soft_success"));
    }
}
