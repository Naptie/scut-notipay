# scut-notipay

基于 Node.js 与 node-napcat-ts 的应用程序，用于查询并提醒华南理工大学广州国际校区与大学城校区的宿舍缴费事项。

`config.json` 内容如下：

```json
{
  "napcatWs": "ws://127.0.0.1:3001",
  "napcatToken": "your_napcat_token",
  "encryptionKey": "your_encryption_key",
  "commandNames": ["scut-notipay", "snp"]
}
```
