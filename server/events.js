// In-process event bus so HTTP routes can notify the game layer (e.g. kick a banned user).
import { EventEmitter } from 'node:events';

export const bus = new EventEmitter();
// Events:
//   'user:updated' (user)  - account changed by an admin; game rooms re-check access
