'use strict';
function browserMode(value='headless'){
 if(!['headed','headless'].includes(value))throw Error('Choose Headed (visible) or Headless (background) for E2E browsers.');
 return value;
}
module.exports={browserMode};
