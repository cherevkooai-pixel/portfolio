/**
 * Gmail → Solid CRM. Runs inside YOUR Gmail (script.google.com), every 5 minutes.
 * It sends new mail (sender, subject, first 4,000 characters, Gmail's spam/category flags) to the CRM,
 * which sorts each one into Lead / Other / Spam. Nothing is deleted or changed in Gmail.
 *
 * Setup (once):
 *  1. script.google.com → New project → paste this file.
 *  2. Project Settings → Script properties → add:
 *       CRM_URL           https://go.solidlandscapeinc.com
 *       EMAIL_INTAKE_KEY  (the same value as the Worker secret EMAIL_INTAKE_KEY)
 *  3. Run `install` once and approve the Gmail permission. Done.
 */
function syncToCrm() {
  var props = PropertiesService.getScriptProperties();
  var url = props.getProperty('CRM_URL'), key = props.getProperty('EMAIL_INTAKE_KEY');
  if (!url || !key) throw new Error('Set CRM_URL and EMAIL_INTAKE_KEY in Script properties');
  var since = Number(props.getProperty('LAST_SYNC') || (Date.now() - 2 * 86400000));
  var startedAt = Date.now();
  var after = Math.floor((since - 3600000) / 1000); // 1 h overlap; the CRM ignores duplicates
  var me = Session.getActiveUser().getEmail().toLowerCase();

  var cats = {};
  ['promotions', 'social', 'updates', 'forums'].forEach(function (c) {
    GmailApp.search('category:' + c + ' after:' + after, 0, 100).forEach(function (t) {
      t.getMessages().forEach(function (m) { cats[m.getId()] = c; });
    });
  });

  var messages = [];
  GmailApp.search('in:anywhere -in:sent -in:drafts -in:trash -in:chats after:' + after, 0, 100).forEach(function (t) {
    var spam = t.isInSpam();
    t.getMessages().forEach(function (m) {
      if (m.getDate().getTime() < since - 3600000) return;
      if (m.getFrom().toLowerCase().indexOf(me) !== -1) return; // your own replies
      messages.push({
        id: m.getId(), threadId: t.getId(), from: m.getFrom(), subject: m.getSubject(),
        body: m.getPlainBody().slice(0, 4000), date: m.getDate().toISOString(),
        spam: spam, category: cats[m.getId()] || 'primary'
      });
    });
  });

  for (var i = 0; i < messages.length; i += 50) {
    var res = UrlFetchApp.fetch(url.replace(/\/$/, '') + '/api/intake/email', {
      method: 'post', contentType: 'application/json', muteHttpExceptions: true,
      headers: { Authorization: 'Bearer ' + key },
      payload: JSON.stringify({ messages: messages.slice(i, i + 50) })
    });
    if (res.getResponseCode() !== 200) throw new Error('CRM said ' + res.getResponseCode() + ': ' + res.getContentText().slice(0, 200));
  }
  props.setProperty('LAST_SYNC', String(startedAt)); // only after every batch was accepted
}

function install() {
  ScriptApp.getProjectTriggers().forEach(function (t) { ScriptApp.deleteTrigger(t); });
  ScriptApp.newTrigger('syncToCrm').timeBased().everyMinutes(5).create();
  syncToCrm();
}
