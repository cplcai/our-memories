# 和柏的回忆

蔡旆伦与柏君祥的静态情侣回忆网站，纪念日为 2026 年 5 月 11 日。

## 更新内容

编辑 `config.js`，修改昵称、纪念日、时间轴、相册和心愿。恋爱天数按北京时间的日期差计算，纪念日当天为 0 天。

添加照片时，先上传照片到 `images` 文件夹，再向 `photos` 数组添加内容。

```js
{ src: "./images/our-photo.jpg", caption: "照片的故事", date: "2026-05-11" },
```

向 `stories` 添加回忆。

```js
{ date: "2026-05-11", title: "回忆的标题", text: "想记下的话" },
```

向 `wishes` 添加心愿，完成后将 `done` 改为 `true`。

```js
{ text: "想一起做的事", done: false },
```

提交保存后，GitHub Pages 会自动更新。页面支持手机浏览，添加照片后可点击放大查看。

## 部署

仓库 Settings → Pages → Deploy from a branch → main → / (root) → Save。

这是独立编写的静态实现。内容在仓库中维护，没有在线编辑后台。当前风景图片是氛围配图，可以替换为自己的照片，替换时保留 `images/scenery.jpg` 文件名。

氛围配图来源于 Unsplash。

页面、照片和仓库内容均公开可见。
