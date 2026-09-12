import { createRoot } from 'react-dom/client';
import EmberApp from '../app/EmberApp';
import '../app/globals.css';
import '../app/ember.css';

const root = document.getElementById('root');
if (!root) throw new Error('Ember could not open its journal.');
createRoot(root).render(<EmberApp />);
