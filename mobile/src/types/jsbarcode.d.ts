declare module 'jsbarcode' {
 const barcode:(target:{encodings?:{data:string}[]},value:string,options:Record<string,unknown>)=>void;
 export default barcode;
}
