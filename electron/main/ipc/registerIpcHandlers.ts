import { registerAppWorkflowIpcHandlers } from './appWorkflowIpc';
import { registerDragIpcHandlers } from './dragIpc';
import { registerFileSystemIpcHandlers } from './fileSystemIpc';
import { registerGitSyncIpcHandlers } from './gitSyncIpc';
import { registerProjectDomainIpcHandlers } from './projectDomainIpc';
import { registerProjectIpcHandlers } from './projectIpc';

export function registerIpcHandlers() {
  registerProjectIpcHandlers();
  registerDragIpcHandlers();
  registerAppWorkflowIpcHandlers();
  registerProjectDomainIpcHandlers();
  registerGitSyncIpcHandlers();
  registerFileSystemIpcHandlers();
}
