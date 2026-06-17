import { startElectronApp } from './main/app/bootstrap';
import { registerIpcHandlers } from './main/ipc/registerIpcHandlers';

registerIpcHandlers();
startElectronApp();
