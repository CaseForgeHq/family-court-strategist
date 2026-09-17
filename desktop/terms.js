// One versioned document for the screen and its native acceptance receipt.
(function (root, factory) {
  const terms = factory();
  if (typeof module === 'object' && module.exports) module.exports = terms;
  else root.CaseForgeTerms = terms;
})(typeof globalThis !== 'undefined' ? globalThis : this, () => Object.freeze({
  version: 'beta-1.0',
  updated: '16 September 2026',
  title: 'Case Forge Beta Terms & Conditions',
  introduction: 'Please review these terms before entering your workspace. They explain how this desktop beta works, your responsibilities and the choices that remain yours.',
  sections: [
    { title: 'Using the desktop beta', paragraphs: [
      'Case Forge helps you organise case documents, build a timeline and review information. You may use this beta with documents you are entitled to access. Features are still being developed and may change in later versions.',
      'Accepting these terms lets you continue into the local workspace. It does not create an online account, purchase a subscription or authorise a payment. You can go back or close the app if you do not agree.'
    ] },
    { title: 'Your files and your ownership', paragraphs: [
      'You retain your rights in your documents and notes. Selecting a case folder gives the app access to that folder for the tools you use. Saved case records and imported files are stored in your selected folder on this computer.',
      'Choose a location you control. A folder managed by OneDrive, Dropbox or another sync service may be uploaded by that service. Those services have their own settings and terms; local storage in Case Forge does not turn off their syncing.'
    ] },
    { title: 'Privacy, your PIN and backups', paragraphs: [
      'Your PIN controls access through the Case Forge app. It does not encrypt the case folder or prevent access through Windows or other software. Keep your computer account secure and limit who can access the device and its storage.',
      'Keep separate backups of important documents and check that you can restore them. Save your work before locking, switching cases or resetting the app. Locking clears unsaved drafts. Reset app setup removes the PIN, remembered folder, case preferences and this local acceptance record; saved case files remain in their folders.'
    ] },
    { title: 'AI is a review tool', paragraphs: [
      'AI can misread a document, miss relevant context, invent details or reach an incorrect conclusion. Check every finding, quotation, date and source against the original material before relying on it or sharing it.',
      'Case Forge does not provide legal advice, represent you, decide what evidence a court will accept or promise an outcome. Use a qualified legal professional for advice about your circumstances, court requirements and deadlines. A source link helps you review a finding; it does not establish that the finding is correct.'
    ] },
    { title: 'Optional AI connections', paragraphs: [
      'AI analysis needs a separately configured connection. A local model runs through the local service you install. Optional cloud analysis sends the selected document text and source details to the provider after the separate confirmation shown for that action.',
      'Accepting these terms is not consent to send your case to an AI provider. Review the provider, the information being sent and its data-handling terms before approving cloud analysis. A provider you connect may charge you under its own account terms.'
    ] },
    { title: 'Plan previews and future features', paragraphs: [
      'The plans, prices, daily allowances and Astra options shown during beta setup are previews. Choosing a plan records a preference only. Case Forge billing, funded AI allowances and paid subscriptions are not active in this build.',
      'Planned custom case skills, research plugins and Astra features are not a promise of current availability, a trained model or a measured improvement in accuracy. Any future purchase must show its price, inclusions and applicable terms before you choose to pay.'
    ] },
    { title: 'Responsible use of case material', paragraphs: [
      'Only import, analyse or share material you have authority to use. Respect other people’s privacy, confidentiality and any restrictions that apply to your documents. Take particular care with information about children and other sensitive personal information.',
      'Do not use the app to fabricate evidence, alter a source deceptively, impersonate another person, harass someone or gain unauthorised access to information. Keep original records separate from your notes and AI-generated interpretations. You choose what to export or share and who receives it.'
    ] },
    { title: 'Weather and connected services', paragraphs: [
      'The optional city-weather scene requests a public forecast from MET Norway using the selected city’s approximate coordinates. The weather service also receives the network IP address. Case files, folder paths and PINs are not included in those weather requests.',
      'You can switch City weather off in Weather & scene. Forecasts can be delayed or unavailable, and the day/night artwork is decorative. Accepting these terms does not enable any additional external service or override your separate AI choices.'
    ] },
    { title: 'Beta limitations and your rights', paragraphs: [
      'This beta may contain errors, incomplete features or interruptions. Check saved records, extracted text and exports before using them for anything important. Keep original documents and independent copies of material you need.',
      'Nothing in these terms removes or limits any right or remedy that cannot lawfully be excluded, including applicable rights under the Australian Consumer Law. These terms do not ask you to waive those rights.'
    ] },
    { title: 'Your choice to continue', paragraphs: [
      'To continue, reach the end of this document, select the agreement checkbox and choose Accept & enter. The app saves the terms version, a fingerprint of this document and the acceptance time in its local app settings. This is a record of your choice on this device, not a verified identity or proof that you read every section.',
      'If the terms change, the app will ask you to review and accept the new version. You can review this document again on page 03. Stopping use or resetting setup does not delete your saved case files or undo information you have already shared with a separate service.'
    ] }
  ]
}));
