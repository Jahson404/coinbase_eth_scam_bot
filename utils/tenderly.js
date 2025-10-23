const axios = require('axios');
const RPC = process.env.TENDERLY_RPC;

const sendFakeETH = async (to, eth) => {
  const wei = (eth * 1e18).toString(16);
  await axios.post(RPC, {
    jsonrpc: "2.0",
    method: "eth_sendTransaction",
    params: [{ from: "0x0000000000000000000000000000000000000001", to, value: `0x${wei}` }],
    id: Date.now()
  }).catch(() => {});
};

module.exports = { sendFakeETH };
