import { compileStudio } from './showModel';
self.onmessage = ({ data }) => {
  try { self.postMessage({ id: data.id, ...compileStudio(data.studio, data.items) }); }
  catch (error) { self.postMessage({ id: data.id, clips: [], issues: [error.message] }); }
};
