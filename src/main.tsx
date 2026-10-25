import { render } from 'preact';
import { App } from './app/App';
import './app/swUpdate';

render(<App />, document.getElementById('app')!);
