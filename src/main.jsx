// 這個檔案是啟動 React 應用程式的 "啟動按鈕"
import React from 'react';
import ReactDOM from 'react-dom/client';

// 修正：因為 App.jsx 和 main.jsx 都在 src/ 資料夾裡，所以必須使用相對路徑 './' (當前目錄)
import App from './App.jsx';

// 找到 index.html 裡的 <div id="root"> 並將 App 啟動
ReactDOM.createRoot(document.getElementById('root')).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>
);
