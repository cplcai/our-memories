// 网站内容统一在这里维护。日期使用 YYYY-MM-DD，图片放进 images 文件夹。
window.MEMORIES = {
  title: "和柏的回忆",
  personOne: "蔡旆伦",
  personTwo: "柏君祥",
  startDate: "2026-05-11",
  introduction: "想把每一次心动、每一场日落，\n和每一个有你的明天，都好好收藏。",
  stories: [
    {
      date: "2026-05-01",
      title: "要一起见家长",
      text: "答应柏柏啦",
      status: "待实现",
    },
    {
      date: "2026-05-11",
      title: "我们的故事，从这一天开始",
      text: "蔡旆伦 ♡ 柏君祥",
    },
    {
      date: "2026-05-16",
      title: "第一次亲亲",
      text: "(✿◡‿◡)",
    },
    {
      date: "2026-11-13",
      title: "恋爱小站正式成立",
      text: "",
    },
    {
      date: "2026-12-31",
      title: "想一起看张杰演唱会跨年",
      text: "能做到吗 得抢得到票 柏柏还得请得到假",
      status: "计划中",
    },
  ],
  // 相册清单在 photo-library.js 中维护，外层照片的 caption 保留原文件名配文。
  photos: window.PHOTO_LIBRARY,
  // 添加心愿时填写 { text: "想一起做的事", done: false }，完成后改为 true。
  wishes: [
    { text: "过年回家给柏柏寄梅干菜小烧饼", done: false },
    { text: "想自驾青甘大环线", done: false },
    { text: "想去延吉", done: false },
  ],
};
