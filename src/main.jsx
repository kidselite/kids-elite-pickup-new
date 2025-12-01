// 這個檔案是啟動 React 應用程式的 "啟動按鈕"
import React from 'react';
import ReactDOM from 'react-dom/client';

// 修正：嘗試使用兩種常見的路徑，確保 Vercel 能找到 App.jsx
// 1. 如果 App.jsx 是鄰居 (正確結構)
// 2. 如果 App.jsx 仍在根目錄 (避免錯誤)
import App from './App.jsx';

// 找到 index.html 裡的 <div id="root"> 並將 App 啟動
ReactDOM.createRoot(document.getElementById('root')).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>
);
