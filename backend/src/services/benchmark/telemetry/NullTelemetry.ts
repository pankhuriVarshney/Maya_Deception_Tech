import { TelemetryObservation } from '../types';

/** The unprotected host records nothing, so the defender sees nothing. */
export function nullTelemetry(): TelemetryObservation {
  return {
    available: false,
    note: 'no honeypot or monitoring: the attacker activity is invisible to the defender',
    events: [],
    loginsRecorded: null,
    sessionsObserved: null,
    sourceIps: [],
    firstEventAt: null,
    lastEventAt: null,
    postHocClassification: false,
  };
}
