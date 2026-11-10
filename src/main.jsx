import { createRoot } from 'react-dom/client';
import App from './App.jsx';
import Mini from './components/Mini.jsx';
import './styles.css';
import './styles-v2.css';
import './styles-studio.css';
import './fonts.css';

if (location.hash === '#chatrender') {
  // hidden window that draws chat overlays (no UI)
  import('./chatrender.js');
} else if (location.hash === '#capsrender') {
  // hidden window that draws caption overlays (same code as the Studio preview)
  import('./capsrender.js');
} else {
  const isMini = location.hash === '#mini';
  createRoot(document.getElementById('root')).render(isMini ? <Mini /> : <App />);
}
