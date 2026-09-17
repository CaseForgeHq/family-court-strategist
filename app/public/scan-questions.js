// Shared scan contract: stable IDs bind submitted questions to saved answers.
export const SCAN_QUESTIONS = Object.freeze([
  {
    "id": "context",
    "number": 1,
    "title": "Context and jurisdiction",
    "question": "What is this document about, and which jurisdiction and event dates are supported?",
    "group": "context"
  },
  {
    "id": "provenance",
    "number": 2,
    "title": "Document identity, provenance, stamps and distinct dates",
    "question": "Who created or supplied it, what stamps or identifiers appear, and which dates refer to events, creation, filing or service?",
    "group": "evidence"
  },
  {
    "id": "facts",
    "number": 3,
    "title": "Facts and attributed claims",
    "question": "What does the document establish directly, and what claims are attributed to each person?",
    "group": "evidence"
  },
  {
    "id": "evidence",
    "number": 4,
    "title": "Supporting evidence and its limitations",
    "question": "What evidence supports the claims, and what cannot be established from this document?",
    "group": "evidence"
  },
  {
    "id": "laws",
    "number": 5,
    "title": "Relevant law",
    "question": "Which verified legal provisions may be relevant, with jurisdiction, applicable dates and remaining assumptions?",
    "group": "evidence"
  },
  {
    "id": "discrepancies",
    "number": 6,
    "title": "Discrepancies",
    "question": "Which material details differ within this document, and where are both details recorded?",
    "group": "review"
  },
  {
    "id": "inconsistencies",
    "number": 7,
    "title": "Inconsistencies",
    "question": "Which statements or sequences are inconsistent within this document, and why?",
    "group": "review"
  },
  {
    "id": "contradictions",
    "number": 8,
    "title": "Direct contradictions within the document",
    "question": "Do two distinct source passages directly contradict each other? Identify both passages or explain why none is established.",
    "group": "review"
  },
  {
    "id": "misleading",
    "number": 9,
    "title": "Potentially misleading statements",
    "question": "Which statements could mislead in context, what source supports that concern, and what alternative explanation remains?",
    "group": "review"
  },
  {
    "id": "patterns",
    "number": 10,
    "title": "Patterns within the document",
    "question": "What repeated behaviour or wording appears within this document, without inferring a pattern across other files?",
    "group": "followup"
  },
  {
    "id": "risk",
    "number": 11,
    "title": "Supported risk and impact",
    "question": "What risks or impacts are supported, including child impact only where evidenced?",
    "group": "followup"
  },
  {
    "id": "followup",
    "number": 12,
    "title": "Opportunities and follow-up",
    "question": "What practical clarification, missing evidence or follow-up would resolve the supported issues?",
    "group": "followup"
  },
  {
    "id": "output",
    "number": 13,
    "title": "Structured storage and document-local identifiers",
    "question": "How are the findings and sources organised using identifiers belonging only to this document?",
    "group": "followup"
  }
].map(Object.freeze));
export const QUESTION_VERSION = 1;
