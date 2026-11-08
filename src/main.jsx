import { createRoot } from 'react-dom/client';
import App from './App.jsx';
import Mini from './components/Mini.jsx';
import './styles.css';

const isMini = location.hash === '#mini';
createRoot(document.getElementById('root')).render(isMini ? <Mini /> : <App />);
