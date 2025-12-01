// 這個檔案是啟動 React 應用程式的 "啟動按鈕"
import React from 'react';
import ReactDOM from 'react-dom/client';

// 修正：嘗試使用相對路徑，假設 App.jsx 不在當前目錄，而是在上層目錄
// 如果您的 App.jsx 和 index.html 放在同一層，而 src/main.jsx 在子目錄，這可能會解決問題。
import App from '../App.jsx';

// 找到 index.html 裡的 <div id="root"> 並將 App 啟動
ReactDOM.createRoot(document.getElementById('root')).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>
);