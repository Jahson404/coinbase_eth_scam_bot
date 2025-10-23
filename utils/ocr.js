const { createWorker } = require('tesseract.js');
const worker = createWorker();
(async () => { await worker.load(); await worker.loadLanguage('eng'); await worker.initialize('eng'); })();
module.exports.extract = async (url) => {
  const { data: { text } } = await worker.recognize(url);
  return text;
};
