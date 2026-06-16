# PlayPlan

HTML / CSS / JavaScript だけで動く個人用カレンダーです。既存の予定は `localStorage` に保存され、今回の変更で Firebase Authentication + Cloud Firestore による個人同期にも対応しました。

## ファイル

- `index.html`: 画面構成
- `styles.css`: 見た目
- `app.js`: カレンダー表示、予定CRUD、Firebase同期
- `firebase-config.js`: Firebase Web SDK の設定値
- `firestore.rules`: Firestore Security Rules
- `vercel.json`: Vercel 設定

## 現在の仕様

- `STORAGE_KEY = "game-friend-calendar-events"` は変更していません
- 既存の `localStorage` データは削除しません
- 未ログイン時はローカル保存のみ
- Googleログイン後は本人の `users/{uid}/events/{eventId}` を使って同期
- 初回移行は自動ではなく、`ローカル予定をFirebaseに移行` ボタンを押したときだけ実行
- Firestore オフライン永続化はまだ入れていません

## Firebase 設定

1. Firebase コンソールで Web アプリを作成
2. Authentication で `Google` を有効化
3. Firestore Database を作成
4. `firebase-config.js` のプレースホルダーを実値に置き換え
5. Firestore Rules に `firestore.rules` の内容を反映
6. Authentication の `Authorized domains` に公開ドメインを追加

## ローカル起動

```powershell
node server.js
```

ブラウザで `http://localhost:5173` を開いて確認します。
