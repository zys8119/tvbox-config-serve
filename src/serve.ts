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
  const { wd } = req.query;
  if (wd) {
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
          vod_pic: "",
          vod_remarks: "Node测试",
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
          name: "低智商犯罪",
          cover: "https://example.com/cover.jpg",
          url: "https://example.com/play.mp4",
        },
        {
          vod_id: "1",
          vod_name: "测试电影",
          vod_pic: "https://picsum.photos/300/400",
          vod_remarks: "测试",
        },
      ],
    },
  });
});
app.listen(port, () => {
  console.log(`Example app listening at http://localhost:${port}`);
});
