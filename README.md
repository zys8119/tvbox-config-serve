# tvbox json 配置node服务

## 解析tvbox json配置vod_play_from、vod_play_url

```ts
function parseUrls(item: Record<string, any>): Record<string, any> {
  const { vod_play_from, vod_play_url } = item;
  const urls = vod_play_url.split("$$$").map((e: any) =>
    ((data: Array<Array<string>>) => {
      return data.reduce((pre: any, cur: any) => {
        pre.push({
          page: cur[0],
          id: cur[1],
        });
        return pre;
      }, []);
    })(e.split("#").map((e: any) => e.split("$"))),
  );
  return vod_play_from
    .split("$$$")
    .reduce((pre: any, cur: any, index: number) => {
      pre.push({
        flag: cur,
        list: urls[index].map((e: any) => ({
          ...e,
          url: `http://127.0.0.1:3001/play?flag=${cur}&id=${e.id}`,
        })),
      });
      return pre;
    }, []);
}
```

## tvbox 4k资源脚本

```ts
/**
 * Woshinidie（橘汁）—— TVBox `csp_Woshinidie` 的 Node.js 服务化实现
 *
 * 来源：sources/com/github/catvod/spider/Woshinidie.java
 * 该 Java 爬虫使用字符串 XOR 混淆，本文件中的常量均为还原后的明文。
 *
 * 设计要点：
 *   - 仅依赖 Node 内置模块（crypto / http / fetch / Buffer），无需 npm install
 *   - Protobuf 采用最小手写编解码，不引入 protobufjs
 *   - 以 HTTP 服务形式暴露 home / category / detail / play / search
 *
 * 启动： node nodejs/main.ts
 * 环境变量：PORT（默认 3000）、JUZHI_EXTEND（自定义 extend 配置地址）
 */

import crypto from "node:crypto";
import http from "node:http";
import https from "node:https";

/* ============================== 常量 ============================== */

const DEFAULT_HOST = "http://103.36.167.27:18004";
const AES_KEY = "ed5fdsgucxumegqa";
const RSA_PUB_DEFAULT =
  "MIGfMA0GCSqGSIb3DQEBAQUAA4GNADCBiQKBgQCr8SzZhjYy+rsya1K09t8d2K50pWFoBkgUqMpKOiW+3IEVKd4eTdvg9RSOjQ82kypL6R9BnsmrS1V8s4PVDwjQbUtYhTPPC9Hz16qY7rpD6m0d2vr09/UpWQ5uOy9PR0QTrsioveZ+DIe9jc3C+zBCu/kZSY/R8stwJoiitki3gwIDAQAB";
const KEY0 = "11GK2we32144LO&hilUITB)FMd1khdaF";
const KEY1 = "OC1A06E197EF10CF3F6058CA7A803B5E";
const DEFAULT_EXTEND = "https://9763.kstore.vip/files/juzhi.json";
const UA = "okhttp/3.12.1";
const PAGE_SIZE = "21";

const NSFW =
  /(情色|色情|成人|伦理|倫理|理论|理論|三级|三級|无码|無碼|有码|有碼|步兵|骑兵|騎兵|福利|自拍|探花|偷拍|露点|露點|激情|肉番|里番|裏番|岛国|島國|島国|av|sm|情欲|情慾|淫|同性)/i;

const DIRECT_EXTS = [
  "mp4",
  "m3u8",
  "flv",
  "mkv",
  "avi",
  "ts",
  "mov",
  "mpd",
  "m4a",
  "wmv",
];

/* ============================== 加密工具 ============================== */

/** AES 加密：ECB 输出 Base64，CBC 输出 hex（与原实现 b() 一致） */
function aesEncrypt(
  text: string,
  key: string,
  mode: "ECB" | "CBC" = "ECB",
  iv?: string,
): string {
  const alg = "aes-" + key.length * 8 + "-" + mode.toLowerCase();
  const cipher = crypto.createCipheriv(
    alg,
    Buffer.from(key, "utf8"),
    mode === "CBC" ? Buffer.from(iv as string, "utf8") : null,
  );
  const out = Buffer.concat([cipher.update(text, "utf8"), cipher.final()]);
  return mode === "CBC" ? out.toString("hex") : out.toString("base64");
}

/** AES 解密（ECB/PKCS7，Base64 输入，与原实现 a() 一致） */
function aesDecrypt(b64: string, key: string): string {
  const decipher = crypto.createDecipheriv(
    "aes-" + key.length * 8 + "-ecb",
    Buffer.from(key, "utf8"),
    null,
  );
  const out = Buffer.concat([
    decipher.update(Buffer.from(b64, "base64")),
    decipher.final(),
  ]);
  return out.toString("utf8");
}

/** RSA 公钥加密（PKCS1Padding），用于 sig 签名 */
function rsaSign(text: string, pubB64: string): string {
  const key = crypto.createPublicKey({
    key: Buffer.from(pubB64, "base64"),
    format: "der",
    type: "spki",
  });
  return crypto
    .publicEncrypt(
      { key, padding: crypto.constants.RSA_PKCS1_PADDING },
      Buffer.from(text, "utf8"),
    )
    .toString("base64");
}

const RANDOM_ALPHABET =
  "1234567890ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz";

/** 随机串：n-1 位随机 + '='（与原实现 g() 一致） */
function randomStr(n: number): string {
  let s = "";
  for (let i = 0; i < n - 1; i++) {
    s += RANDOM_ALPHABET[crypto.randomInt(RANDOM_ALPHABET.length)];
  }
  return s + "=";
}

/* ============================== Protobuf 手写编解码 ============================== */

type PBField = { wire: number; num?: number; buf?: Buffer };

function wVarint(n: number): Buffer {
  const bytes: number[] = [];
  let v = n;
  while (v > 0x7f) {
    bytes.push((v & 0x7f) | 0x80);
    v = Math.floor(v / 128);
  }
  bytes.push(v & 0x7f);
  return Buffer.from(bytes);
}

function wTag(field: number, wire: number): Buffer {
  return wVarint(field * 8 + wire);
}

function wInt(field: number, n: number): Buffer {
  if (n === 0) return Buffer.alloc(0);
  return Buffer.concat([wTag(field, 0), wVarint(n)]);
}

function wStr(field: number, s: string): Buffer {
  if (!s) return Buffer.alloc(0);
  const b = Buffer.from(s, "utf8");
  return Buffer.concat([wTag(field, 2), wVarint(b.length), b]);
}

function readVarint(buf: Buffer, p: number): [number, number] {
  let result = 0;
  let shift = 0;
  let b = 0;
  do {
    b = buf[p++];
    result += (b & 0x7f) * Math.pow(2, shift);
    shift += 7;
  } while (b & 0x80);
  return [result, p];
}

function pbRead(buf: Buffer): Map<number, PBField[]> {
  const out = new Map<number, PBField[]>();
  let p = 0;
  while (p < buf.length) {
    const [tag, p1] = readVarint(buf, p);
    p = p1;
    const num = Math.floor(tag / 8);
    const wire = tag % 8;
    let f: PBField;
    if (wire === 0) {
      const [v, p2] = readVarint(buf, p);
      p = p2;
      f = { wire, num: v };
    } else if (wire === 2) {
      const [len, p2] = readVarint(buf, p);
      p = p2;
      f = { wire, buf: buf.subarray(p, p + len) };
      p += len;
    } else if (wire === 5) {
      f = { wire, num: buf.readUInt32LE(p) };
      p += 4;
    } else if (wire === 1) {
      f = { wire, num: Number(buf.readBigUInt64LE(p)) };
      p += 8;
    } else {
      break; // 不支持的 wire type，停止解析
    }
    const arr = out.get(num) ?? [];
    arr.push(f);
    out.set(num, arr);
  }
  return out;
}

const pbFirst = (m: Map<number, PBField[]>, n: number): PBField | undefined =>
  m.get(n)?.[0];

function pbStr(m: Map<number, PBField[]>, n: number): string {
  const f = pbFirst(m, n);
  return f?.buf ? f.buf.toString("utf8") : "";
}

function pbInt(m: Map<number, PBField[]>, n: number): number {
  const f = pbFirst(m, n);
  return f?.num ?? 0;
}

function pbMsg(
  m: Map<number, PBField[]>,
  n: number,
): Map<number, PBField[]> | null {
  const f = pbFirst(m, n);
  return f?.buf ? pbRead(f.buf) : null;
}

function pbList(m: Map<number, PBField[]>, n: number): Buffer[] {
  return (m.get(n) ?? []).filter((f) => f.buf).map((f) => f.buf as Buffer);
}

/* ============================== Protobuf 消息定义 ============================== */

/** SecureRequest： aes1=1 aes2=2 fake=3 timestamp=4 random=5 */
function encodeSecureRequest(o: {
  a1: string;
  a2: string;
  fake: string;
  ts: number;
  rand: string;
}): Buffer {
  return Buffer.concat([
    wStr(1, o.a1),
    wStr(2, o.a2),
    wStr(3, o.fake),
    wInt(4, o.ts),
    wStr(5, o.rand),
  ]);
}

/** RSARequest： timestamp=1 sign=2 fake1=3 random=4 fake2=5 */
function encodeRSARequest(o: {
  ts: number;
  sign: string;
  fake1: string;
  rand: string;
  fake2: string;
}): Buffer {
  return Buffer.concat([
    wInt(1, o.ts),
    wStr(2, o.sign),
    wStr(3, o.fake1),
    wStr(4, o.rand),
    wStr(5, o.fake2),
  ]);
}

/** ApiResult： code=1 msg=2 data=3 */
function decodeApiResult(buf: Buffer): {
  code: number;
  msg: string;
  data: Buffer;
} {
  const m = pbRead(buf);
  const f = pbFirst(m, 3);
  return {
    code: pbInt(m, 1),
    msg: pbStr(m, 2),
    data: f?.buf ?? Buffer.alloc(0),
  };
}

/** DramaCoverImage： path=1 thumbnailPath=2 */
function decodeCover(buf: Buffer): { path: string; thumbnail: string } {
  const m = pbRead(buf);
  return { path: pbStr(m, 1), thumbnail: pbStr(m, 2) };
}

/** DramaBean：area=1 cover=2 id=3 brief=4 name=5 stars=6 director=7 type=8 updateTime=10 vodPubdate=11 actor=12 remark=13 year=14 clazz=15 */
function decodeDramaBean(buf: Buffer) {
  const m = pbRead(buf);
  const cover = pbMsg(m, 2);
  return {
    id: pbInt(m, 3),
    name: pbStr(m, 5),
    pic: cover ? pbStr(cover, 2) : "",
    remark: pbStr(m, 13),
    clazz: pbStr(m, 15),
    area: pbStr(m, 1),
    actor: pbStr(m, 12),
    director: pbStr(m, 7),
    brief: pbStr(m, 4),
    year: pbInt(m, 14),
    type: pbStr(m, 8),
  };
}

/** DramaBeanPage： dramaBean=1 total=16 */
function decodeDramaBeanPage(buf: Buffer): {
  total: number;
  beans: ReturnType<typeof decodeDramaBean>[];
} {
  const m = pbRead(buf);
  return { total: pbInt(m, 16), beans: pbList(m, 1).map(decodeDramaBean) };
}

/** DramaVideoBean： id=1 title=2 path=4 source=9 sourceCn=10 */
function decodeDramaVideo(buf: Buffer) {
  const m = pbRead(buf);
  return {
    id: pbInt(m, 1),
    title: pbStr(m, 2),
    path: pbStr(m, 4),
    source: pbStr(m, 9),
    sourceCn: pbStr(m, 10),
  };
}

/** DramaDetailBean：只取业务需要的字段 */
function decodeDramaDetail(buf: Buffer) {
  const m = pbRead(buf);
  const cover = pbMsg(m, 2);
  return {
    id: pbInt(m, 4),
    name: pbStr(m, 9),
    pic: cover ? pbStr(cover, 2) : "",
    actor: pbStr(m, 25),
    director: pbStr(m, 12),
    tag: pbStr(m, 13),
    area: pbStr(m, 1),
    year: pbInt(m, 18),
    remark: pbStr(m, 26),
    intro: pbStr(m, 6),
    videos: pbList(m, 29).map(decodeDramaVideo),
  };
}

/** ParsePlayUrlBean： playUrl=1 headers=6(map<string,string>) */
function decodeParsePlayUrl(buf: Buffer) {
  const m = pbRead(buf);
  const headers: Record<string, string> = {};
  for (const entry of pbList(m, 6)) {
    const em = pbRead(entry);
    headers[pbStr(em, 1)] = pbStr(em, 2);
  }
  return { playUrl: pbStr(m, 1), headers };
}

/* ============================== HTTP 层 ============================== */

/**
 * 底层 HTTP 请求。
 * 注意：不能用 fetch —— 它会把 header 名统一转成小写，
 * 而服务端按 `publicParams` 这种大小写敏感的名字取值，会导致“公共参数请求头不能为空”。
 */
function request(
  url: string,
  method: "GET" | "POST",
  headers: Record<string, string>,
  body?: Buffer,
): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const u = new URL(url);
    const mod = u.protocol === "https:" ? https : http;
    const req = mod.request(url, { method, headers }, (res) => {
      const chunks: Buffer[] = [];
      res.on("data", (d: Buffer) => chunks.push(d));
      res.on("end", () => resolve(Buffer.concat(chunks)));
    });
    req.on("error", reject);
    if (body) req.end(body);
    else req.end();
  });
}

async function postProto(
  url: string,
  body: Buffer,
  headers: Record<string, string>,
): Promise<Buffer> {
  return request(url, "POST", headers, body);
}

async function getText(
  url: string,
  headers?: Record<string, string>,
): Promise<string> {
  const buf = await request(url, "GET", headers ?? {});
  return buf.toString("utf8");
}

/* ============================== 工具函数 ============================== */

const isNSFW = (s: string): boolean => !!s && NSFW.test(s);

/** 判断是否直链（原实现 j()，用扩展名判断以规避正则转义） */
function isDirectUrl(u: string): boolean {
  if (!u) return false;
  const noQuery = u.split("?")[0];
  const dot = noQuery.lastIndexOf(".");
  if (dot < 0) return false;
  return DIRECT_EXTS.includes(noQuery.slice(dot + 1).toLowerCase());
}

/** 清晰度排序权重（原实现 k()，数值越小越靠前） */
function qualityRank(key: string, episodes: string[]): number {
  if (episodes.join("#").toLowerCase().includes(".m3u8")) return 99;
  const k = key.toLowerCase();
  if (k.includes("4k") || k.includes("臻")) return 0;
  if (k.includes("2k")) return 1;
  if (k.includes("蓝光") || k.includes("超高清") || k.includes("超清"))
    return 2;
  if (k.includes("高清")) return 3;
  return 4;
}

/* ============================== 主体 ============================== */

interface ExtendConfig {
  host?: string;
  pub?: string;
  keys?: string;
  md5?: string;
  sha1?: string;
  pkg?: string;
  version?: string;
  site?: string;
}

class Woshinidie {
  /** API 根地址（可被 extend 的 host / site.domain 覆盖） */
  private host = DEFAULT_HOST;
  /** RSA 公钥：初始为内置值，init 后由服务端下发替换 */
  private rsaPub = RSA_PUB_DEFAULT;
  /** AES-256 密钥：由 extend 派生，用于加密业务参数 */
  private f = "";
  /** 两组密钥 [0]=派生 f 用，[1]=签名用 */
  private keys: string[] = [KEY0, KEY1];
  private cfg: ExtendConfig = {};
  private abid = String(crypto.randomInt(10000));
  private uuid = crypto.randomUUID().replace(/-/g, "").toUpperCase();

  /* ---------- 初始化 ---------- */

  async init(extend?: string): Promise<void> {
    const url = extend && extend.trim() ? extend.trim() : DEFAULT_EXTEND;
    try {
      const raw = await getText(url);
      this.cfg = JSON.parse(raw.trim()) as ExtendConfig;
    } catch (e) {
      console.warn(
        "[init] 拉取 extend 失败，使用内置默认值:",
        (e as Error).message,
      );
      this.cfg = {};
    }

    if (this.cfg.host) this.host = this.cfg.host;
    if (this.cfg.pub) this.rsaPub = this.cfg.pub;
    if (this.cfg.keys) {
      const ks = this.cfg.keys.split(",");
      if (ks.length >= 2) this.keys = ks;
    }

    // 派生 AES-256 密钥 f（原实现 L578）
    const src = [
      this.cfg.md5 ?? "",
      "######",
      this.cfg.sha1 ?? "",
      "~~~~~~",
      this.cfg.pkg ?? "",
      ">>>+++",
      (this.cfg.version ?? "").split(".").join(""),
    ].join("");
    const inner = aesEncrypt(src, this.keys[0], "ECB");
    const outer = Buffer.from(inner, "utf8").toString("base64");
    this.f = (outer.slice(0, 16) + outer.slice(-16)).toUpperCase();

    // site 若配置，则拉取其 domain 覆盖 host（原实现 L584-L590）
    if (this.cfg.site) {
      try {
        const siteJson = JSON.parse((await getText(this.cfg.site)).trim());
        if (siteJson.domain) this.host = siteJson.domain;
      } catch {
        /* 忽略 site 解析失败 */
      }
    }

    // 请求 /api/v5/find/app/zone 换取服务端下发的 RSA 公钥（原实现 L593-L599）
    try {
      const ts = Date.now();
      const r = randomStr(16);
      const body = encodeRSARequest({
        ts,
        sign: rsaSign(String(ts) + r, this.rsaPub),
        fake1: randomStr(16),
        rand: r,
        fake2: randomStr(16),
      });
      const buf = await postProto(
        this.host + "/api/v5/find/app/zone",
        body,
        this.authHeaders(),
      );
      const m = pbRead(decodeApiResult(buf).data);
      const pub = pbStr(m, 2) + pbStr(m, 3) + pbStr(m, 4) + pbStr(m, 5);
      if (pub) this.rsaPub = pub;
    } catch (e) {
      console.warn(
        "[init] 获取动态公钥失败，沿用内置公钥:",
        (e as Error).message,
      );
    }
    console.log("[init] host =", this.host, "| f =", this.f);
  }

  /* ---------- 设备指纹 d() ---------- */

  private deviceJson(): Record<string, unknown> {
    return {
      country: "CN",
      vName: this.cfg.version ?? "",
      cpuId: "MT6893Z%2FCZA",
      young: 0,
      facturer: "Xiaomi",
      pkg: this.cfg.pkg ?? "",
      uuid: this.uuid,
      resolution: "1080x2272",
      mac: "02%3A00%3A00%3A00%3A00%3A00",
      abid: this.abid,
      model: "M2012K11AC",
      plat: "android",
      udid: this.uuid,
      dpi: "440",
      net: 1,
      lang: "zh",
      brand: "Redmi",
      density: "2.75",
      appName: "%E6%A9%98%E6%B1%81",
      cpu: "arm64-v8a",
      chid: "10000",
      carrier: "%E7%A7%BB%E5%8A%A8",
      _vOsCode: "33",
      vOs: "13",
      v: 1,
      tenantId: "",
      vApp: (this.cfg.version ?? "").split(".").join(""),
      device: 0,
      androidID: "9774d56d682e549c",
    };
  }

  /* ---------- 请求头 c() ---------- */

  private authHeaders(): Record<string, string> {
    const ts = Date.now();
    const r = randomStr(16);
    const device = this.deviceJson();

    // sig = RSA(timestamp + random + 设备指纹中的 vApp)
    // 注意：密钥用 this.rsaPub（init 后由 /api/v5/find/app/zone 下发的动态公钥），
    // 对应 Java 的 `str = TextUtils.isEmpty(this.e) ? this.d : this.e`。
    const vApp = (this.cfg.version ?? "").split(".").join("");
    const sig = rsaSign(String(ts) + r + vApp, this.rsaPub);
    // sig2 / sig3 由 AES-ECB(timestamp+random) 的 Base64 切开
    const signed = aesEncrypt(String(ts) + r, this.keys[1], "ECB");
    const sig2 = signed.slice(0, 8);
    const sig3 = signed.slice(8);

    // 关键：原实现 c() 会把这 5 个字段一起塞进 paramsData 再加密，
    // 服务端解密后从 paramsData 内取 sig 校验；缺失会报 “sig不能为空”。
    const params = {
      ...device,
      sig,
      random_str: r,
      timestamp: ts,
      sig2,
      sig3,
    };
    // paramsData = AES-CBC(设备指纹 + 签名字段)，key = iv = AES_KEY
    const paramsData = aesEncrypt(
      JSON.stringify(params),
      AES_KEY,
      "CBC",
      AES_KEY,
    );

    return {
      sig,
      random_str: r,
      timestamp: String(ts),
      sig2,
      sig3,
      "User-Agent": UA,
      "Content-Type": "application/x-protobuf",
      publicParams: JSON.stringify({ paramsData }),
    };
  }

  /* ---------- GET 请求头 e() ---------- */

  private jsonHeaders(): Record<string, string> {
    const paramsData = aesEncrypt(
      JSON.stringify(this.deviceJson()),
      AES_KEY,
      "CBC",
      AES_KEY,
    );
    return {
      "User-Agent": UA,
      Accept: "application/json",
      "Content-Type": "application/json; charset=utf-8",
      publicParams: JSON.stringify({ paramsData }),
    };
  }

  /* ---------- protobuf 调用（带诊断日志） ---------- */

  private async callProto(path: string, params: Record<string, string>) {
    const buf = await postProto(
      this.host + path,
      this.secureBody(params),
      this.authHeaders(),
    );
    const result = decodeApiResult(buf);
    if (!result.data.length) {
      console.warn("[api]", path, "code=" + result.code, "msg=" + result.msg);
    }
    return result;
  }

  /* ---------- 请求体 h(map) ---------- */

  private secureBody(params: Record<string, string>): Buffer {
    const ts = Date.now();
    const r8 = randomStr(8);
    const r20 = randomStr(20);
    const plain = Object.entries(params)
      .filter(([, v]) => v !== undefined && v !== null && v !== "")
      .map(([k, v]) => k + "=" + v)
      .join("&");
    if (!this.f) throw new Error("尚未初始化，请先调用 init()");
    const enc = r8 + aesEncrypt(plain + ts, this.f, "ECB");
    return encodeSecureRequest({
      a1: enc.slice(0, 20),
      a2: enc.slice(20),
      fake: r20,
      ts,
      rand: r8,
    });
  }

  /* ---------- 业务接口 ---------- */

  /** 首页分类 + 筛选器 */
  async homeContent() {
    const url = this.host + "/api/v3/drama/getCategory?orderBy=type_id";
    const json = JSON.parse(await getText(url, this.jsonHeaders()));
    const arr: any[] = json.data ?? [];

    const classes: { type_id: string; type_name: string }[] = [];
    const filters: Record<string, any[]> = {};
    const fieldKeys = ["class", "lang", "area", "year", "extend_sort"];

    for (const item of arr) {
      const name = String(item.name ?? "");
      if (name === "公告" || name === "直播") continue;
      const id = String(item.id ?? "");
      if (!id) continue;
      classes.push({ type_id: id, type_name: name });

      const conv = item.converUrl;
      if (!conv) continue;
      let convObj: Record<string, string>;
      try {
        convObj = typeof conv === "string" ? JSON.parse(conv) : conv;
      } catch {
        continue;
      }
      const group: any[] = [];
      for (const key of fieldKeys) {
        const raw = convObj[key];
        if (!raw) continue;
        const values = String(raw)
          .split(",")
          .filter((s) => s !== "")
          .map((s) => ({ n: s, v: s }));
        if (values.length) group.push({ key, name: key, value: values });
      }
      if (group.length) filters[id] = group;
    }

    return { class: classes, filters };
  }

  /** 首页推荐（响应需 AES 解密后才是 JSON） */
  async homeVideoContent() {
    const url = this.host + "/api/ex/v3/security/tag/list";
    const raw = (await getText(url, this.jsonHeaders())).trim();
    let enc = "";
    try {
      enc = String(JSON.parse(raw).data ?? "");
    } catch {
      // 接口直接返回密文（非 JSON 包装）
      enc = raw;
    }
    if (!enc) return { list: [] };

    // 原实现为双重解密：先 this.f，再 keys[1]
    const list: any[] = [];
    const sections = JSON.parse(
      aesDecrypt(aesDecrypt(enc, this.f), this.keys[1]),
    );
    for (const block of sections) {
      for (const section of block.sections ?? []) {
        for (const item of section.vodList ?? []) {
          if (isNSFW(String(item.clazz ?? ""))) continue;
          const cover = item.coverImage ?? {};
          list.push({
            vod_id: String(item.id ?? ""),
            vod_name: String(item.name ?? ""),
            vod_pic: String(cover.path ?? ""),
            vod_remarks: String(item.remark ?? ""),
          });
        }
      }
    }
    return { list };
  }

  /** 分类列表 */
  async categoryContent(
    tid: string,
    page: string,
    ext?: Record<string, string>,
  ) {
    const params: Record<string, string> = {
      typeId1: tid,
      page,
      pagesize: PAGE_SIZE,
      vodOrderBy: ext?.extend_sort ?? "最新",
      vodArea: ext?.area ?? "",
      vodLang: ext?.lang ?? "",
      vodClass: ext?.class ?? "",
      vodYear: ext?.year ?? "",
    };
    const result = await this.callProto("/api/proto/v5/drama/category", params);
    const pageData = decodeDramaBeanPage(result.data);
    const list = pageData.beans
      .filter((b) => !isNSFW(b.clazz))
      .map((b) => ({
        vod_id: String(b.id),
        vod_name: b.name,
        vod_pic: b.pic,
        vod_remarks: b.remark,
      }));
    return {
      page: Number(page) || 1,
      pagecount: 2147483647,
      limit: 2147483647,
      total: pageData.total || 2147483647,
      list,
    };
  }

  /** 详情（按线路分组，非直链用 Base64 包裹 {source, playUrl}） */
  async detailContent(id: string) {
    const buf = await postProto(
      this.host + "/api/proto/v5/drama/getDetail",
      this.secureBody({ id }),
      this.authHeaders(),
    );
    const result = decodeApiResult(buf);
    const d = decodeDramaDetail(result.data);

    const groups = new Map<string, string[]>();
    for (const v of d.videos) {
      const from = v.sourceCn || "橘汁";
      if (!groups.has(from)) groups.set(from, []);
      let path = v.path;
      if (!isDirectUrl(path)) {
        path = Buffer.from(
          JSON.stringify({ source: v.source, playUrl: path }),
          "utf8",
        ).toString("base64");
      }
      groups.get(from)!.push(v.title + "$" + path);
    }

    const entries = [...groups.entries()].sort(
      (a, b) => qualityRank(a[0], a[1]) - qualityRank(b[0], b[1]),
    );
    const froms = entries.map(([k]) => k);
    const urls = entries.map(([, v]) => v.join("#"));
    if (froms.length) froms[0] = "嗷呜橘汁";

    return {
      list: [
        {
          vod_id: String(d.id || id),
          vod_name: d.name,
          vod_pic: d.pic,
          vod_actor: d.actor,
          vod_director: d.director,
          vod_area: d.area,
          vod_year: d.year ? String(d.year) : "",
          vod_remarks: d.remark,
          vod_content: d.intro,
          vod_play_from: froms.join("$$$"),
          vod_play_url: urls.join("$$$"),
        },
      ],
    };
  }

  /** 播放：直链直接返回，否则换取真实播放地址 */
  async playerContent(flag: string, playUrl: string) {
    if (isDirectUrl(playUrl)) {
      return { parse: 0, url: playUrl, header: {} };
    }
    const payload = JSON.parse(
      Buffer.from(playUrl, "base64").toString("utf8"),
    ) as {
      source?: string;
      playUrl?: string;
    };
    const params: Record<string, string> = {};
    for (const [k, v] of Object.entries(payload)) params[k] = String(v ?? "");

    const buf = await postProto(
      this.host + "/api/proto/v5/videoUsableUrl",
      this.secureBody(params),
      this.authHeaders(),
    );
    const result = decodeApiResult(buf);
    const p = decodeParsePlayUrl(result.data);
    if (!p.playUrl) return { parse: 0, url: "", header: {}, msg: "链接为空" };
    return { parse: 0, url: p.playUrl, header: p.headers };
  }

  /** 搜索 */
  async searchContent(wd: string) {
    const params = { searchKeys: wd, page: "1", pagesize: PAGE_SIZE };
    const buf = await postProto(
      this.host + "/api/proto/v5/drama/search",
      this.secureBody(params),
      this.authHeaders(),
    );
    const result = decodeApiResult(buf);
    const pageData = decodeDramaBeanPage(result.data);
    return {
      list: pageData.beans
        .filter((b) => !isNSFW(b.clazz))
        .map((b) => ({
          vod_id: String(b.id),
          vod_name: b.name,
          vod_pic: b.pic,
          vod_remarks: b.remark,
        })),
    };
  }
}

/* ============================== 服务入口 ============================== */

const spider = new Woshinidie();
let initTask: Promise<void> | null = null;

function ensureInit(): Promise<void> {
  if (!initTask) initTask = spider.init(process.env.JUZHI_EXTEND);
  return initTask;
}

function sendJson(res: http.ServerResponse, code: number, data: unknown): void {
  const body = JSON.stringify(data);
  res.writeHead(code, { "Content-Type": "application/json; charset=utf-8" });
  res.end(body);
}

const server = http.createServer(async (req, res) => {
  const u = new URL(req.url ?? "/", "http://localhost");
  const q = u.searchParams;

  try {
    if (u.pathname === "/health") {
      return sendJson(res, 200, { ok: true });
    }
    if (u.pathname === "/") {
      return sendJson(res, 200, {
        name: "Woshinidie (橘汁) Node Service",
        routes: [
          "GET /home",
          "GET /home/video",
          "GET /category?tid=<id>&page=1&ext=<urlencoded json>",
          "GET /detail?id=<vod_id>",
          "GET /play?flag=<line>&id=<base64 payload>",
          "GET /search?wd=<keyword>",
          "GET /health",
        ],
      });
    }

    await ensureInit();

    if (u.pathname === "/home") {
      return sendJson(res, 200, await spider.homeContent());
    }
    if (u.pathname === "/home/video") {
      return sendJson(res, 200, await spider.homeVideoContent());
    }
    if (u.pathname === "/category") {
      const tid = q.get("tid") ?? "";
      const page = q.get("page") ?? "1";
      let ext: Record<string, string> | undefined;
      const extRaw = q.get("ext");
      if (extRaw) {
        try {
          ext = JSON.parse(extRaw);
        } catch {
          ext = undefined;
        }
      }
      return sendJson(res, 200, await spider.categoryContent(tid, page, ext));
    }
    if (u.pathname === "/detail") {
      return sendJson(res, 200, await spider.detailContent(q.get("id") ?? ""));
    }
    if (u.pathname === "/play") {
      return sendJson(
        res,
        200,
        await spider.playerContent(q.get("flag") ?? "", q.get("id") ?? ""),
      );
    }
    if (u.pathname === "/search") {
      return sendJson(res, 200, await spider.searchContent(q.get("wd") ?? ""));
    }

    sendJson(res, 404, { code: 0, msg: "not found" });
  } catch (e) {
    console.error("[error]", u.pathname, e);
    sendJson(res, 500, { code: 0, msg: (e as Error).message });
  }
});

const PORT = Number(process.env.PORT ?? 3001);
server.listen(PORT, () => {
  console.log("Woshinidie service listening on http://127.0.0.1:" + PORT);
});

```