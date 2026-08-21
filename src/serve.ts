import express, { Request, Response, NextFunction } from "express";
import fs from "fs-extra";
import chalk from "chalk";
await Promise.resolve();
const app = express();
const port = 3333;
app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use((req: Request, res: Response, next: NextFunction) => {
  console.info(
    chalk.blue(new Date().toISOString()),
    chalk.green(req.method),
    chalk.yellow(decodeURIComponent(req.originalUrl)),
  );
  next();
});
app.get("/", (req: Request, res: Response) => {
  const { wd, ac, ids } = req.query;
  if (wd && ac === "detail") {
    return res.json({
      code: 1,
      msg: "ok",
      page: 1,
      pagecount: 1,
      limit: 20,
      total: 1,
      list: [
        {
          vod_id: "1",
          vod_name: `搜索：${wd}`,
          vod_pic:
            "https://gips0.baidu.com/it/u=1690853528,2506870245&fm=3028&app=3028&f=JPEG&fmt=auto?w=1024&h=1024",
          vod_remarks: "Node测试",
        },
        {
          vod_id: "2",
          vod_name: `搜索：${wd}`,
          vod_pic:
            "https://gips0.baidu.com/it/u=1690853528,2506870245&fm=3028&app=3028&f=JPEG&fmt=auto?w=1024&h=1024",
          vod_remarks: "Node测试2",
        },
      ],
    });
  }
  if (ac == "detail" && ids) {
    return res.json({
      code: 1,
      msg: "ok",
      page: 1,
      pagecount: 1,
      limit: 20,
      total: 1,
      list: [
        {
          vod_id: "1",
          vod_name: "测试电影",
          vod_pic:
            "https://gips0.baidu.com/it/u=1690853528,2506870245&fm=3028&app=3028&f=JPEG&fmt=auto?w=1024&h=1024",
          vod_remarks: "测试",
          vod_year: "2026",
          vod_area: "中国",
          vod_lang: "国语",
          vod_actor: "测试演员",
          vod_director: "测试导演",
          vod_content: "这是一个 TVBox Node API 测试影片",

          // 播放地址
          vod_play_from: "默认线路",

          // 格式：
          // 第1集$播放地址#第2集$播放地址
          vod_play_url:
            "第1集$https://example.com/video/1.m3u8#第2集$https://example.com/video/2.m3u8",
        },
        {
          vod_id: "2",
          vod_name: "测试电影",
          vod_play_from: "线路A$$线路B",

          vod_play_url:
            "正片$https://a.com/movie.m3u8$$正片$https://b.com/movie.m3u8",
        },
      ],
    });
  }
  return res.json(fs.readJsonSync(import.meta.dirname + "/tvbox.json"));
});
app.get("/vod", (req: Request, res: Response) => {
  res.json({
    code: 200,
    msg: "success",
    data: {
      list: [
        {
          id: 1,
          name: "我的影视",
          cover: "https://example.com/cover.jpg",
          url: "https://example.com/play.mp4",
        },
      ],
    },
  });
});
app.listen(port, () => {
  console.log(`Example app listening at http://localhost:${port}`);
});
