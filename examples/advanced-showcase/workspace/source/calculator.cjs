'use strict';
function quote(quantity,coupon=''){
 if(!Number.isInteger(quantity)||quantity<1||quantity>12)throw RangeError('Quantity must be an integer from1 to12.');
 if(typeof coupon!=='string')throw TypeError('Coupon must be text.');
 const subtotal=Math.round(quantity*249*(coupon==='LAB10'?0.9:1)*100)/100,shipping=subtotal>=500?0:49;
 return {quantity,coupon,subtotal,shipping,total:Math.round((subtotal+shipping)*100)/100,currency:'SEK'};
}
module.exports={quote};
