import { createRoot } from 'react-dom/client';

import App from './App';

// Plugin suites — must import before React renders so all registerPlugin()
// calls populate the registry before any hub/host component reads it.
import './plugins/restoration';

import './index.css';

createRoot(document.getElementById('root')!).render(<App />);
