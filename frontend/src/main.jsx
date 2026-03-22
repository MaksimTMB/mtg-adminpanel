import React from 'react';
import ReactDOM from 'react-dom/client';
import './index.css';
import App from './App.jsx';
import { AppProvider } from './AppContext.jsx';

ReactDOM.createRoot(document.getElementById('app')).render(
  <AppProvider><App/></AppProvider>
);
