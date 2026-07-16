// 通知(§4.13)。実装はOSネイティブ通知のみだが、NotificationSink インターフェース経由にし、
// 将来 WebhookNotifier(Discord/Slack) を1クラス追加するだけで拡張できる構造にする。
const { Notification } = require("electron");

class OsNotificationSink {
  notify({ title, body }) {
    if (Notification.isSupported()) {
      new Notification({ title, body }).show();
    }
  }
}

// 将来の拡張例(今回は実装しない):
// class WebhookNotifier { constructor(url) {...} notify({title, body}) { fetch(url, ...) } }

const sinks = [new OsNotificationSink()];

function notifyAll(payload) {
  for (const s of sinks) {
    try {
      s.notify(payload);
    } catch {}
  }
}

module.exports = { notifyAll };
