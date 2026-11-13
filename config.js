// 网站内容统一在这里维护。日期使用 YYYY-MM-DD，图片放进 images 文件夹。
window.MEMORIES = {
  title: "和柏的回忆",
  personOne: "蔡旆伦",
  personTwo: "柏君祥",
  startDate: "2026-05-11",
  introduction: "想把每一次心动、每一场日落，\n和每一个有你的明天，都好好收藏。",
  stories: [
    {
      date: "2026-05-11",
      title: "我们的故事，从这一天开始",
      text: "蔡旆伦 ♡ 柏君祥",
    },
  ],
  // 相册清单在 photo-library.js 中维护，外层照片的 caption 保留原文件名配文。
  photos: window.PHOTO_LIBRARY,
  // 添加心愿时填写 { text: "想一起做的事", done: false }，完成后改为 true。
  wishes: [],
};
