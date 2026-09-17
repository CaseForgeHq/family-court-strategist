// Invented organisations and reserved .example addresses. No network activity.
export const DEMO_ROLES = ['Parent · Alex household', 'Parent · Jamie household', 'Solicitor · Harbour Legal', 'Solicitor · Meadow Legal', 'School liaison · Riverbank School', 'Mediator · Bridge Mediation', 'Clinic coordinator · Linden Clinic', 'Family support contact'];
export const DEMO_CONNECTIONS = [[1, 2, 4, 7], [0, 3, 4], [0, 3, 4, 5], [1, 2, 5], [0, 1, 2], [2, 3], [0, 1], [0]];
export function scenarioRecords(count, date) {
  const record = (subject, from, to, body, extra = {}) => ({ subject, from, to, body, kind: 'email', event: true, ...extra });
  const rows = [
    record('Case opened — Morgan arrangements', 2, 3, 'Harbour Legal and Meadow Legal have opened a shared correspondence record for the Morgan parenting arrangements. Please send all external case correspondence using reference MORGAN-DEMO.', { kind: 'milestone' }),
    record('Proposed Friday collection at 3:30 pm', 2, 3, 'Alex proposes Friday collection at 3:30 pm at the school gate. Please confirm whether Jamie agrees before the plan is treated as settled.', { thread: 'collection' }),
    record('Re: Proposed Friday collection at 3:30 pm', 3, 2, 'Jamie can attend at 4:00 pm, not 3:30 pm. The collection time is still a proposal. Please check the school arrangements.', { thread: 'collection', reply: 1 }),
    record('School dismissal information', 4, 2, 'School finishes at 3:00 pm on Friday. The supervised after-school programme can cover the period until 4:00 pm. Written collection authority is still required.', { thread: 'school' }),
    record('Request for collection authority', 2, 4, 'Both representatives are considering 4:00 pm collection. Please confirm the form required for the after-school programme; this message does not itself authorise collection.', { thread: 'school', reply: 3 }),
    record('Re: Request for collection authority', 4, 2, 'We have supplied the collection-authority form. The school will record the approved arrangement once a completed form is received.', { thread: 'school', reply: 4 }),
    record('Shared activity expenses', 0, 1, 'Date,Description,Amount AUD,Status\nDATE,After-school programme,48.00,Receipt supplied\nDATE,Activity materials,32.50,Receipt requested\n', { kind: 'expense', event: false }),
    record('Mediation meeting confirmed', 5, 2, 'Bridge Mediation confirms a joint meeting with both legal representatives. Agenda: collection time, written authority and the missing activity receipt.', { kind: 'appointment' }),
    record('Agreed collection plan — meeting record', 2, 3, 'Both representatives recorded agreement to Friday collection at 4:00 pm following the supervised programme. The school form must be completed separately. The 3:30 pm proposal was superseded. The activity receipt remains outstanding.', { kind: 'minutes' }),
  ];
  const topics = ['Collection authority follow-up', 'Activity receipt request', 'School programme confirmation', 'Mediation action review', 'Updated contact details', 'Schedule clarification'];
  while (rows.length < count - 1) {
    const i = rows.length, topic = topics[(i - 9) % topics.length];
    rows.push(record(`${topic} ${String(i - 8).padStart(3, '0')}`, i % 2 ? 2 : 3, i % 2 ? 3 : 2,
      `External follow-up ${i - 8} in the Morgan example. The agreed collection time remains 4:00 pm. Please confirm the ${topic.toLowerCase()} against the source record. This message records a request, not a finding.`, { thread: `follow-up-${Math.floor((i - 9) / 2)}`, ...(i % 2 === 0 ? { reply: i - 1 } : {}) }));
  }
  rows.push(record('Case closed — handover summary', 2, 3, 'The representatives confirm that this example matter is closed. The agreed collection plan and school correspondence are retained. The outstanding receipt is noted as a gap, not proof of payment or non-payment.', { kind: 'milestone' }));
  return rows.map((row, i) => ({ ...row, date: date(-90 + Math.floor(i * 89 / (rows.length - 1))), index: i }));
}
