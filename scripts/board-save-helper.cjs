'use strict';
async function completeBoardSave(page,{name}={}) {
 const dialog=page.locator('dialog.ab-save-dialog');await dialog.waitFor();
 const field=key=>dialog.locator('[name="save-'+key+'"]');
 if(name!==undefined)await field('name').fill(name);
 if(!await field('name').inputValue())await field('name').fill('QA agent board');
 if(await field('mode').inputValue()==='overwrite')await field('confirm').check();
 await dialog.locator('[data-save-submit]').click();await dialog.waitFor({state:'detached'});
}
module.exports={completeBoardSave};
