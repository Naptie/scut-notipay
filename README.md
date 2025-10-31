# scut-notipay

基于 Node.js 与 node-napcat-ts 的应用程序，用于查询并提醒华南理工大学广州国际校区与大学城校区的宿舍缴费事项。

## 配置

`config.json` 内容如下：

```json
{
  "napcatWs": "ws://127.0.0.1:3001",
  "napcatToken": "your_napcat_token",
  "encryptionKey": "your_encryption_key",
  "commandNames": ["scut-notipay", "snp"],
  "billingRetryCount": 3
}
```

## 代理配置

如果需要通过代理访问网络，可以设置以下环境变量：

### HTTP/HTTPS 代理

```bash
# 支持基本认证的代理格式
export HTTP_PROXY=http://username:password@proxy-host:port
# 或
export HTTPS_PROXY=http://username:password@proxy-host:port
```

**HTTP 代理 URL 格式示例：**

- 无认证：`http://proxy.example.com:8080`
- 基本认证：`http://user:pass@proxy.example.com:8080`

### SOCKS5 代理

```bash
# 支持基本认证的 SOCKS5 代理格式
export SOCKS_PROXY=socks5://username:password@proxy-host:port
# 或
export SOCKS5_PROXY=socks5://username:password@proxy-host:port
```

**SOCKS5 代理 URL 格式示例：**

- 无认证：`socks5://proxy.example.com:1080`
- 基本认证：`socks5://user:pass@proxy.example.com:1080`

**注意：** SOCKS 代理优先级高于 HTTP 代理。如果同时设置了两种代理，将使用 SOCKS 代理。

应用程序将自动检测并使用配置的代理进行所有 HTTP/HTTPS 请求。
