import express, { Request, Response, NextFunction } from "express";
const app = express();
const port = 3333;
app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use((req: Request, res: Response, next: NextFunction) => {
  console.log(req.url);
  next();
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
      ],
    },
  });
});
app.listen(port, () => {
  console.log(`Example app listening at http://localhost:${port}`);
});
