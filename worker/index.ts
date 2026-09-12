import { createMobileApi } from '../lib/server/mobile-api';

const handleRequest = createMobileApi();

const worker: ExportedHandler<EmberWorkerEnv> = {
  fetch(request, env) {
    return handleRequest(request, env);
  },
};

export default worker;
