/* MedStock cloud app. Requires config.js values and database.sql setup. */
let db = null, currentUser = null, medicines = [], suppliers = [], sales = [], supplierOffers = [], cart = [], salesChart = null, purchaseOrders = [], stockMovements = [], barcodeStream = null, barcodeFrame = null;
let authMode = "login";
const $ = id => document.getElementById(id);
const todayString = localDate(new Date());

function localDate(d){return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,"0")}-${String(d.getDate()).padStart(2,"0")}`;}
function esc(v){return String(v ?? "").replace(/[&<>"']/g,c=>({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[c]));}
function money(v){return "₹"+Number(v||0).toLocaleString("en-IN",{minimumFractionDigits:2,maximumFractionDigits:2});}
function toast(msg){const t=$("toast");t.textContent=msg;t.classList.add("show");setTimeout(()=>t.classList.remove("show"),2600);}
function setCloud(text,isError=false){$("cloudStatus").textContent=(isError?"● ":"● ")+text;$("cloudStatus").style.color=isError?"#dc4545":"#15966a";}
function configured(){return window.MEDSTOCK_CONFIG && !window.MEDSTOCK_CONFIG.SUPABASE_URL.includes("PASTE_") && !window.MEDSTOCK_CONFIG.SUPABASE_ANON_KEY.includes("PASTE_");}

async function init(){
  $("todayDate").textContent=new Date().toLocaleDateString("en-IN",{weekday:"long",day:"numeric",month:"long",year:"numeric"});
  $("loginTab").onclick=()=>setAuthMode("login"); $("signupTab").onclick=()=>setAuthMode("signup");
  $("authForm").addEventListener("submit",handleAuth); $("logoutBtn").onclick=logout;
  if(!configured()){ $("authMessage").textContent="First add your Supabase Project URL and anon public key in config.js."; return; }
  db=window.supabase.createClient(MEDSTOCK_CONFIG.SUPABASE_URL,MEDSTOCK_CONFIG.SUPABASE_ANON_KEY);
  const {data:{session}}=await db.auth.getSession();
  if(session) await enterApp(session.user);
  db.auth.onAuthStateChange(async(_event,session)=>{if(session && !currentUser) await enterApp(session.user); if(!session && currentUser) showAuth();});
}
function setAuthMode(mode){authMode=mode;$("loginTab").classList.toggle("active",mode==="login");$("signupTab").classList.toggle("active",mode==="signup");$("authSubmit").textContent=mode==="login"?"Login":"Create account";$("authPassword").autocomplete=mode==="login"?"current-password":"new-password";$("authMessage").textContent="";}
async function handleAuth(e){
  e.preventDefault(); if(!db){$("authMessage").textContent="Configure Supabase first.";return;}
  const email=$("authEmail").value.trim(),password=$("authPassword").value;
  $("authSubmit").disabled=true;$("authSubmit").textContent="Please wait...";
  try{
    const result=authMode==="login"?await db.auth.signInWithPassword({email,password}):await db.auth.signUp({email,password});
    if(result.error) throw result.error;
    if(authMode==="signup" && !result.data.session){$("authMessage").style.color="#15966a";$("authMessage").textContent="Account created. Check your email to confirm, then log in.";setAuthMode("login");}
    else if(result.data.user) await enterApp(result.data.user);
  }catch(err){$("authMessage").style.color="#dc4545";$("authMessage").textContent=err.message;}
  finally{$("authSubmit").disabled=false;$("authSubmit").textContent=authMode==="login"?"Login":"Create account";}
}
function showAuth(){currentUser=null;$("app").classList.add("hidden");$("authScreen").classList.remove("hidden");}
async function logout(){await db.auth.signOut();cart=[];showAuth();}
async function enterApp(user){
  currentUser=user;$("profileEmail").textContent=user.email||"Pharmacy Admin";$("authScreen").classList.add("hidden");$("app").classList.remove("hidden");
  setCloud("Loading cloud data...");try{await loadAll();setCloud("Cloud connected");refreshAll();}catch(e){setCloud("Sync error",true);toast("Could not load cloud data: "+e.message);}
}
async function loadAll(){
  const [m,s,sa]=await Promise.all([
    db.from("medicines").select("*").order("created_at",{ascending:true}),
    db.from("suppliers").select("*").order("created_at",{ascending:true}),
    db.from("sales").select("*").order("created_at",{ascending:false})
  ]);
  if(m.error)throw m.error;if(s.error)throw s.error;if(sa.error)throw sa.error;
  const [so,po,mv]=await Promise.all([db.from("supplier_offers").select("*").order("created_at",{ascending:false}),db.from("purchase_orders").select("*").order("created_at",{ascending:false}),db.from("stock_movements").select("*").order("created_at",{ascending:false})]);
  if(so.error){
    const missing=so.error.code==="42P01"||so.error.code==="PGRST205"||/supplier_offers.*(not found|does not exist)|relation .*supplier_offers/i.test(so.error.message||"");
    if(!missing)throw so.error;
    supplierOffers=[];window.medstockOffersTableMissing=true;
  }else{supplierOffers=so.data||[];window.medstockOffersTableMissing=false;}
  medicines=(m.data||[]).map(x=>({...x,manufacture:x.manufacture||"",minimum:Number(x.minimum),quantity:Number(x.quantity),price:Number(x.price),purchase:Number(x.purchase)}));
  window.medstockAdvancedTablesMissing=!!(po.error||mv.error);purchaseOrders=po.error?[]:(po.data||[]);stockMovements=mv.error?[]:(mv.data||[]);suppliers=s.data||[];sales=(sa.data||[]).map(x=>({id:x.invoice_no,customer:x.customer,date:x.sale_date,items:x.items||[],total:Number(x.total)}));
}
async function saveMedicine(record,id){
  const payload={user_id:currentUser.id,name:record.name,category:record.category,batch:record.batch,manufacturer:record.manufacturer,purchase:record.purchase,price:record.price,quantity:record.quantity,minimum:record.minimum,manufacture:record.manufacture||null,expiry:record.expiry,barcode:record.barcode||""};
  const q=id?db.from("medicines").update(payload).eq("id",id):db.from("medicines").insert(payload).select().single();
  const {data,error}=await q;if(error)throw error;return data;
}
function showPage(page){
  document.querySelectorAll(".page").forEach(x=>x.classList.remove("active-page"));$(page).classList.add("active-page");
  document.querySelectorAll(".nav-link").forEach(x=>x.classList.toggle("active",x.dataset.page===page));
  const titles={dashboard:"Dashboard",inventory:"Medicine Inventory",expiry:"Expiry Management",sales:"Sales & Billing",salesHistory:"Sales History",suppliers:"Suppliers",comparison:"Medicine Intelligence",aiInsights:"AI Purchase Advisor",demandLab:"Demand Lab",riskRadar:"Risk Radar",purchaseOrders:"Purchase Order Studio",batchTrace:"Batch Traceability",scanDesk:"Barcode Scan Desk",copilot:"Pharmacy Copilot",reports:"Reports & Analytics"};
  $("pageTitle").textContent=titles[page]||"MedStock";refreshAll();
}
document.querySelectorAll(".nav-link").forEach(a=>a.addEventListener("click",()=>showPage(a.dataset.page)));
function daysLeft(item){const d=new Date(item.expiry+"T00:00:00"),t=new Date(todayString+"T00:00:00");return Math.ceil((d-t)/86400000);}
function status(item){const d=daysLeft(item);if(d<0)return"Expired";if(item.quantity<=item.minimum)return"Low Stock";if(d<=30)return"Expiring Soon";return"Available";}
function badge(s){const c=s==="Expired"?"danger":s==="Available"?"safe":"warning";return `<span class="status ${c}">${s}</span>`;}
function updateDashboard(){
 const totalStock=medicines.reduce((a,x)=>a+x.quantity,0),low=medicines.filter(x=>x.quantity<=x.minimum&&daysLeft(x)>=0).length,exp=medicines.filter(x=>daysLeft(x)<=30).length;
 const daySales=sales.filter(x=>x.date===todayString).reduce((a,x)=>a+x.total,0);
 $("totalMedicines").textContent=medicines.length;$("totalStock").textContent=totalStock.toLocaleString("en-IN");$("lowStock").textContent=low;$("expiring").textContent=exp;$("todaySales").textContent=money(daySales);$("transactions").textContent=sales.filter(x=>x.date===todayString).length;$("alertCount").textContent=low+exp;
 $("recentTable").innerHTML=medicines.slice(-5).reverse().map(x=>`<tr><td><strong>${esc(x.name)}</strong></td><td>${esc(x.batch)}</td><td>${x.quantity}</td><td>${esc(x.expiry)}</td><td>${badge(status(x))}</td></tr>`).join("")||'<tr><td colspan="5">No medicines added yet.</td></tr>';
 $("stockSummary").innerHTML=["Tablet","Capsule","Syrup","Injection","Other"].map(c=>`<div class="summary-row"><span>${c}</span><span>${medicines.filter(x=>x.category===c).length} batches</span></div>`).join("");updateChart();
}
function renderInventory(){
 const term=($("medicineSearch").value||"").toLowerCase(),cat=$("categoryFilter").value;
 const rows=medicines.filter(x=>(x.name.toLowerCase().includes(term)||x.batch.toLowerCase().includes(term))&&(!cat||x.category===cat));
 $("inventoryTable").innerHTML=rows.map(x=>`<tr><td><strong>${esc(x.name)}</strong></td><td>${esc(x.category)}</td><td>${esc(x.batch)}</td><td>${money(x.price)}</td><td>${x.quantity}</td><td>${esc(x.expiry)}</td><td>${badge(status(x))}</td><td><button class="action-btn edit-btn" onclick="editMedicine('${x.id}')">Edit</button><button class="action-btn delete-btn" onclick="deleteMedicine('${x.id}')">Delete</button></td></tr>`).join("")||'<tr><td colspan="8">No matching medicines found.</td></tr>';
}
$("medicineSearch").addEventListener("input",renderInventory);$("categoryFilter").addEventListener("change",renderInventory);
function openMedicineForm(id=""){
 $("medicineForm").reset();$("medicineId").value=id;$("medicineFormTitle").textContent=id?"Edit Medicine":"Add Medicine";
 if(id){const x=medicines.find(m=>m.id===id);if(!x)return;$("medBarcode").value=x.barcode||"";$("medName").value=x.name;$("medCategory").value=x.category;$("medBatch").value=x.batch;$("medManufacturer").value=x.manufacturer;$("medPurchase").value=x.purchase;$("medPrice").value=x.price;$("medQuantity").value=x.quantity;$("medMinimum").value=x.minimum;$("medManufacture").value=x.manufacture||"";$("medExpiry").value=x.expiry;$("medBarcode").value=x.barcode||"";}
 $("medicineModal").classList.add("show");
}
function editMedicine(id){openMedicineForm(id);}
async function deleteMedicine(id){if(!confirm("Delete this medicine batch?"))return;try{const {error}=await db.from("medicines").delete().eq("id",id);if(error)throw error;await loadAll();refreshAll();toast("Medicine deleted.");}catch(e){toast(e.message);}}
$("medicineForm").addEventListener("submit",async e=>{
 e.preventDefault();const id=$("medicineId").value;
 const record={name:$("medName").value.trim(),category:$("medCategory").value,batch:$("medBatch").value.trim(),manufacturer:$("medManufacturer").value.trim(),purchase:Number($("medPurchase").value),price:Number($("medPrice").value),quantity:Number($("medQuantity").value),minimum:Number($("medMinimum").value),manufacture:$("medManufacture").value,expiry:$("medExpiry").value,barcode:$("medBarcode").value.trim()};
 if([record.name,record.category,record.batch,record.expiry].some(v=>!v) || [record.purchase,record.price,record.quantity,record.minimum].some(v=>!Number.isFinite(v)||v<0)){toast("Please complete all required fields with valid values.");return;}
 if(record.expiry<todayString&&!confirm("This batch is already expired. Save for record keeping?"))return;
 try{const before=id?medicines.find(x=>x.id===id):null;const saved=await saveMedicine(record,id);const delta=before?record.quantity-before.quantity:record.quantity;if(delta!==0&&!window.medstockAdvancedTablesMissing){const mv=await db.from("stock_movements").insert({user_id:currentUser.id,medicine_id:saved?.id||id,medicine_name:record.name,batch:record.batch,barcode:record.barcode,movement_type:before?"ADJUSTED":"OPENING",quantity:delta,reference:before?"MANUAL-ADJUSTMENT":"OPENING-BALANCE",notes:before?"Quantity changed from medicine editor":"Initial stock balance"});if(mv.error)throw mv.error;}await loadAll();closeModal("medicineModal");refreshAll();toast(id?"Medicine updated!":"Medicine added!");}catch(err){toast(err.message.includes("duplicate")?"This medicine batch already exists.":err.message);}
});
function renderExpiry(){const rows=medicines.filter(x=>daysLeft(x)<=30).sort((a,b)=>daysLeft(a)-daysLeft(b));$("expiryTable").innerHTML=rows.map(x=>{const d=daysLeft(x);return `<tr><td>${esc(x.name)}</td><td>${esc(x.batch)}</td><td>${x.quantity}</td><td>${esc(x.expiry)}</td><td>${d<0?Math.abs(d)+" days ago":d+" days"}</td><td>${badge(status(x))}</td></tr>`;}).join("")||'<tr><td colspan="6">No expiry alerts. Great job!</td></tr>';}
function renderSaleOptions(){const list=medicines.filter(x=>x.quantity>0&&daysLeft(x)>=0);$("saleMedicine").innerHTML=list.map(x=>`<option value="${x.id}">${esc(x.name)} - ${money(x.price)} (${x.quantity} available)</option>`).join("")||'<option value="">No available medicines</option>';}
function addToCart(){
 const id=$("saleMedicine").value,q=Number($("saleQuantity").value),x=medicines.find(m=>m.id===id);if(!x){toast("Please select a medicine.");return;}if(!Number.isInteger(q)||q<=0){toast("Enter a valid quantity.");return;}
 const old=cart.find(c=>c.id===id),already=old?old.quantity:0;if(already+q>x.quantity){toast("Not enough stock available.");return;}
 if(old)old.quantity+=q;else cart.push({id:x.id,name:x.name,price:x.price,purchasePrice:x.purchase,quantity:q});$("saleQuantity").value=1;renderCart();
}
function removeFromCart(id){cart=cart.filter(x=>x.id!==id);renderCart();}
function renderCart(){$("cartItems").innerHTML=cart.map(x=>`<div class="cart-item"><span><strong>${esc(x.name)}</strong><br>${x.quantity} × ${money(x.price)}</span><span>${money(x.price*x.quantity)} <button class="remove-cart" onclick="removeFromCart('${x.id}')">✕</button></span></div>`).join("")||"No items added yet.";$("cartTotal").textContent=money(cart.reduce((a,x)=>a+x.price*x.quantity,0));}
async function completeSale(){
 if(!cart.length){toast("Add medicines to the cart first.");return;}
 for(const c of cart){const m=medicines.find(x=>x.id===c.id);if(!m||m.quantity<c.quantity||daysLeft(m)<0){toast("Stock changed or batch expired. Check your cart.");return;}}
 const total=cart.reduce((a,x)=>a+x.price*x.quantity,0),invoiceNo="INV-"+Date.now(),date=todayString,customer=$("customerName").value.trim()||"Walk-in Customer",paymentMethod=$("paymentMethod")?.value||"Cash";
 try{
  // Update stock and insert invoice. For production/multiple cashiers, use a server-side database transaction/RPC.
  for(const c of cart){const m=medicines.find(x=>x.id===c.id);const {error}=await db.from("medicines").update({quantity:m.quantity-c.quantity}).eq("id",m.id);if(error)throw error;}
  const savedItems=cart.map(x=>({...x,paymentMethod,grossProfit:(Number(x.price)-Number(x.purchasePrice))*x.quantity}));
  const {error}=await db.from("sales").insert({user_id:currentUser.id,invoice_no:invoiceNo,customer,sale_date:date,items:savedItems,total});if(error)throw error;
  if(!window.medstockAdvancedTablesMissing){for(const c of cart){const m=medicines.find(x=>x.id===c.id);const mv=await db.from("stock_movements").insert({user_id:currentUser.id,medicine_id:m.id,medicine_name:m.name,batch:m.batch,barcode:m.barcode||"",movement_type:"SOLD",quantity:-c.quantity,reference:invoiceNo,notes:"Point-of-sale invoice"});if(mv.error)throw mv.error;}}
  const invoice={id:invoiceNo,customer,date,paymentMethod,items:savedItems,total};cart=[];$("customerName").value="";await loadAll();refreshAll();toast("Invoice generated.");printInvoice(invoice);
 }catch(e){toast("Sale could not be completed: "+e.message+" Please check stock before retrying.");await loadAll();refreshAll();}
}
function printInvoice(inv){
 const w=window.open("","_blank");if(!w){toast("Allow pop-ups to print invoice.");return;}
 const rows=inv.items.map(x=>`<tr><td>${esc(x.name)}</td><td>${x.quantity}</td><td>${money(x.price)}</td><td>${money(x.price*x.quantity)}</td></tr>`).join("");
 w.document.write(`<!doctype html><html><head><title>${esc(inv.id)}</title><style>body{font-family:Arial;padding:30px;color:#222}h1{color:#1769aa}table{width:100%;border-collapse:collapse;margin-top:25px}th,td{padding:12px;border-bottom:1px solid #ddd;text-align:left}.total{text-align:right;margin-top:25px;font-size:20px}</style></head><body><h1>MedStock Pharmacy</h1><p>Medicine Sales Invoice</p><hr><p>Invoice: ${esc(inv.id)}</p><p>Customer: ${esc(inv.customer)}</p><p>Date: ${esc(inv.date)}</p><table><tr><th>Medicine</th><th>Qty</th><th>Price</th><th>Total</th></tr>${rows}</table><div class="total"><b>Total: ${money(inv.total)}</b></div><p>Thank you for visiting!</p><script>window.onload=()=>window.print();<\/script></body></html>`);w.document.close();
}
function renderSales(){$("salesTable").innerHTML=sales.slice(0,20).map(x=>`<tr><td>${esc(x.id)}</td><td>${esc(x.customer)}</td><td>${esc(x.date)}</td><td>${money(x.total)}</td></tr>`).join("")||'<tr><td colspan="4">No sales recorded yet.</td></tr>';}
function openSupplierForm(){$("supplierForm").reset();$("supplierVerification").value="pending";$("supplierModal").classList.add("show");}
$("supplierForm").addEventListener("submit",async e=>{e.preventDefault();try{const {error}=await db.from("suppliers").insert({user_id:currentUser.id,name:$("supplierName").value.trim(),company:$("supplierCompany").value.trim(),phone:$("supplierPhone").value.trim(),email:$("supplierEmail").value.trim(),drug_license:$("supplierLicense").value.trim(),gst_number:$("supplierGST").value.trim(),verification_status:$("supplierVerification").value});if(error)throw error;await loadAll();closeModal("supplierModal");refreshAll();toast("Supplier added.");}catch(err){toast(err.message);}});
async function deleteSupplier(id){if(!confirm("Delete this supplier and its offers?"))return;const {error}=await db.from("suppliers").delete().eq("id",id);if(error){toast(error.message);return;}await loadAll();refreshAll();toast("Supplier deleted.");}
function renderSuppliers(){
 $("supplierCount").textContent=suppliers.length;$("offerCount").textContent=supplierOffers.length;$("selectedOfferCount").textContent=supplierOffers.filter(x=>x.decision_status==="selected").length;$("pendingOfferCount").textContent=supplierOffers.filter(x=>x.decision_status==="pending").length;
 $("supplierTable").innerHTML=suppliers.map(x=>`<tr><td><strong>${esc(x.name)}</strong></td><td>${esc(x.company)}</td><td>${esc(x.phone)}</td><td>${esc(x.email)}</td><td>${esc(x.drug_license||"—")}</td><td><span class="status ${x.verification_status==="verified"?"safe":"warning"}">${esc(x.verification_status||"pending")}</span></td><td><button class="action-btn delete-btn" onclick="deleteSupplier('${x.id}')">Delete</button></td></tr>`).join("")||'<tr><td colspan="7">No suppliers added yet.</td></tr>';
 const term=($("offerSearch")?.value||"").toLowerCase();
 const grouped={};supplierOffers.forEach(o=>{const key=[o.medicine_name,o.strength,o.composition].map(v=>(v||"").trim().toLowerCase()).join("|");(grouped[key] ||= []).push(o);});
 const bestIds=new Set();Object.values(grouped).forEach(arr=>{if(arr.length<2)return;const prices=arr.map(x=>Number(x.purchase_price)),stocks=arr.map(x=>Number(x.available_stock)),exp=arr.map(x=>new Date((x.expiry_date||"1970-01-01")+"T00:00:00").getTime());const minP=Math.min(...prices),maxP=Math.max(...prices),maxS=Math.max(...stocks),maxE=Math.max(...exp);let best=arr.map(o=>{const sup=suppliers.find(s=>s.id===o.supplier_id);const priceScore=maxP===minP?1:(maxP-Number(o.purchase_price))/(maxP-minP);const stockScore=maxS===0?0:Number(o.available_stock)/maxS;const expiryScore=maxE===Math.min(...exp)?1:(new Date(o.expiry_date+"T00:00:00").getTime()-Math.min(...exp))/(maxE-Math.min(...exp));const verifyScore=sup?.verification_status==="verified"?1:0;return {o,score:priceScore*0.4+stockScore*0.2+expiryScore*0.15+verifyScore*0.25};}).sort((a,b)=>b.score-a.score)[0];if(best)bestIds.add(best.o.id);});
 const rows=supplierOffers.filter(o=>{const s=suppliers.find(x=>x.id===o.supplier_id);return [o.medicine_name,o.composition,o.strength,s?.name].join(" ").toLowerCase().includes(term);});
 $("offerTable").innerHTML=rows.map(o=>{const s=suppliers.find(x=>x.id===o.supplier_id)||{};const selected=o.decision_status==="selected",rejected=o.decision_status==="rejected";return `<tr class="${selected?"selected-offer":rejected?"rejected-offer":""}"><td><strong>${esc(o.medicine_name)}</strong></td><td>${esc(o.composition)}</td><td>${esc(o.strength)}</td><td>${esc(o.dosage_form)}</td><td>${esc(o.manufacturer||"—")}</td><td>${esc(o.pack_size)}</td><td>${esc(o.batch_number||"—")}</td><td><strong>${money(o.purchase_price)}</strong></td><td>${o.mrp_per_pack===null||o.mrp_per_pack===undefined?"—":money(o.mrp_per_pack)}</td><td>${Number(o.discount_percent||0)}%</td><td>${o.available_stock}</td><td>${esc(o.expiry_date)}</td><td>${Number(o.delivery_days||0)} days</td><td>${esc(s.name||"Unknown")}${s.verification_status==="verified"?'<span class="verified-mark"> ✓ Verified</span>':""}</td><td>${bestIds.has(o.id)?'<span class="recommend-chip">Recommended</span>':'—'}</td><td>${selected?'<span class="status safe">Selected</span>':rejected?'<span class="status danger">Rejected</span>':`<button class="action-btn edit-btn" onclick="decideOffer('${o.id}','selected')">Select</button> <button class="action-btn delete-btn" onclick="decideOffer('${o.id}','rejected')">Reject</button>`}</td></tr>`;}).join("")||'<tr><td colspan="12">No medicine offers yet. Add suppliers and their medicine offers to compare.</td></tr>';
}
function openOfferForm(){
 if(window.medstockOffersTableMissing){toast("Supplier offers database is not set up yet. Run database.sql in Supabase first.");return;}
 if(!suppliers.length){toast("Add at least one supplier first.");openSupplierForm();return;}
 $("offerForm").reset();$("offerSupplier").innerHTML=suppliers.map(s=>`<option value="${s.id}">${esc(s.name)}${s.company?" — "+esc(s.company):""}</option>`).join("");
 $("offerExpiry").min=todayString;$("offerExpiry").value="";$("offerMinOrder").value="1";$("offerDiscount").value="0";$("offerDelivery").value="0";$("offerModal").classList.add("show");
}
$("offerForm").addEventListener("submit",async e=>{
 e.preventDefault();
 const payload={user_id:currentUser.id,supplier_id:$("offerSupplier").value,medicine_name:$("offerMedicine").value.trim(),composition:$("offerComposition").value.trim(),strength:$("offerStrength").value.trim(),dosage_form:$("offerFormType").value,manufacturer:$("offerManufacturer").value.trim(),pack_size:$("offerPack").value.trim(),purchase_price:Number($("offerPrice").value),available_stock:Number($("offerStock").value),expiry_date:$("offerExpiry").value,decision_status:"pending",batch_number:$("offerBatch").value.trim(),mrp_per_pack:$("offerMrp").value?Number($("offerMrp").value):null,discount_percent:Number($("offerDiscount").value||0),minimum_order_qty:Number($("offerMinOrder").value||1),delivery_days:Number($("offerDelivery").value||0),barcode:$("offerBarcode").value.trim(),offer_notes:$("offerNotes").value.trim()};
 if(!payload.supplier_id||!payload.medicine_name||!payload.composition||!payload.strength||!payload.dosage_form||!payload.pack_size||!payload.expiry_date){toast("Complete all required offer details.");return;}
 if(payload.purchase_price<0||payload.available_stock<0||payload.discount_percent<0||payload.discount_percent>100||payload.minimum_order_qty<1||payload.delivery_days<0||(payload.mrp_per_pack!==null&&payload.mrp_per_pack<payload.purchase_price)){toast("Check price, MRP, discount, stock and order quantity.");return;}
 if(window.medstockOffersTableMissing){toast("Run the supplier-offers SQL migration in Supabase before saving.");return;}
 try{const {error}=await db.from("supplier_offers").insert(payload);if(error)throw error;await loadAll();closeModal("offerModal");refreshAll();toast("Medicine offer saved successfully.");}
 catch(err){toast("Offer not saved: "+err.message);}
});
async function decideOffer(id,decision){const chosen=supplierOffers.find(x=>x.id===id);if(!chosen)return;const same=supplierOffers.filter(x=>x.id!==id&&x.medicine_name.trim().toLowerCase()===chosen.medicine_name.trim().toLowerCase()&&x.strength.trim().toLowerCase()===chosen.strength.trim().toLowerCase()&&x.composition.trim().toLowerCase()===chosen.composition.trim().toLowerCase());if(decision==="selected"&&!confirm("Select this supplier and mark the other matching offers as rejected?"))return;if(decision==="rejected"&&!confirm("Reject this supplier offer? It will remain in your records."))return;try{if(decision==="selected"){for(const other of same){const {error}=await db.from("supplier_offers").update({decision_status:"rejected"}).eq("id",other.id);if(error)throw error;}}const {error}=await db.from("supplier_offers").update({decision_status:decision}).eq("id",id);if(error)throw error;await loadAll();renderSuppliers();toast(decision==="selected"?"Supplier selected; other matching offers rejected.":"Offer rejected and retained in records.");}catch(err){toast(err.message);}}
$("offerSearch").addEventListener("input",renderSuppliers);
$("historySearch").addEventListener("input",renderSalesHistory);$("historyFrom").addEventListener("change",renderSalesHistory);$("historyTo").addEventListener("change",renderSalesHistory);
$("clearHistoryFilters").onclick=()=>{$("historySearch").value="";$("historyFrom").value="";$("historyTo").value="";renderSalesHistory();};
$("historyExportBtn").onclick=exportFilteredHistory;$("closeInvoiceDetail").onclick=()=>$("invoiceDetailPanel").classList.add("hidden");
$("reprintInvoiceBtn").onclick=()=>{if(selectedHistoryInvoice)printInvoice(selectedHistoryInvoice);};
$("intelligenceSearch").addEventListener("input",renderMedicineIntelligence);$("intelligenceSort").addEventListener("change",renderMedicineIntelligence);

let selectedHistoryInvoice=null;
function filteredSales(){
 const term=($("historySearch")?.value||"").trim().toLowerCase(),from=$("historyFrom")?.value||"",to=$("historyTo")?.value||"";
 return sales.filter(x=>(!from||x.date>=from)&&(!to||x.date<=to)&&(!term||[x.id,x.customer,...(x.items||[]).map(i=>i.name)].join(" ").toLowerCase().includes(term)));
}
function renderSalesHistory(){
 const rows=filteredSales(),revenue=rows.reduce((a,x)=>a+x.total,0),units=rows.reduce((a,x)=>a+(x.items||[]).reduce((n,i)=>n+Number(i.quantity||0),0),0);
 const profitRows=rows.flatMap(x=>x.items||[]).filter(i=>Number.isFinite(Number(i.grossProfit))&&i.purchasePrice!==undefined);
 const profit=profitRows.reduce((a,i)=>a+Number(i.grossProfit||0),0);
 $("historyRevenue").textContent=money(revenue);$("historyInvoices").textContent=rows.length;$("historyUnits").textContent=units;
 $("historyProfit").textContent=profitRows.length?money(profit):"—";
 $("historyProfitNote").textContent=profitRows.length?"Calculated only from saved purchase-cost snapshots":"Older invoices do not contain historical purchase costs";
 $("historyTable").innerHTML=rows.map(x=>`<tr><td><strong>${esc(x.id)}</strong></td><td>${esc(x.customer)}</td><td>${esc(x.date)}</td><td>${(x.items||[]).reduce((n,i)=>n+Number(i.quantity||0),0)}</td><td>${esc(x.payment_method||x.paymentMethod||x.items?.[0]?.paymentMethod||"Not recorded")}</td><td><strong>${money(x.total)}</strong></td><td><button class="action-btn edit-btn" onclick="viewInvoice('${esc(x.id)}')">View</button><button class="action-btn secondary-btn" onclick="reprintHistoryInvoice('${esc(x.id)}')">Print</button></td></tr>`).join("")||'<tr><td colspan="7">No invoices match these filters.</td></tr>';
}
function viewInvoice(id){
 const inv=sales.find(x=>x.id===id);if(!inv)return;selectedHistoryInvoice=inv;
 $("invoiceDetailTitle").textContent="Invoice "+inv.id;$("invoiceDetailMeta").textContent=inv.customer+" • "+inv.date+" • "+(inv.payment_method||inv.paymentMethod||inv.items?.[0]?.paymentMethod||"Payment not recorded");
 $("invoiceDetailTable").innerHTML=(inv.items||[]).map(i=>`<tr><td>${esc(i.name)}</td><td>${Number(i.quantity||0)}</td><td>${money(i.price)}</td><td>${money(Number(i.price||0)*Number(i.quantity||0))}</td><td>${i.grossProfit===undefined?"Not recorded":money(i.grossProfit)}</td></tr>`).join("");
 $("invoiceDetailTotal").textContent=money(inv.total);$("invoiceDetailPanel").classList.remove("hidden");$("invoiceDetailPanel").scrollIntoView({behavior:"smooth",block:"nearest"});
}
function reprintHistoryInvoice(id){const inv=sales.find(x=>x.id===id);if(inv)printInvoice(inv);}
function exportFilteredHistory(){
 const rows=[["Invoice","Customer","Date","Payment Method","Medicine","Quantity","Unit Price","Line Total","Recorded Gross Profit","Invoice Total"]];
 filteredSales().forEach(inv=>(inv.items||[]).forEach(i=>rows.push([inv.id,inv.customer,inv.date,inv.payment_method||inv.paymentMethod||"",i.name,i.quantity,i.price,Number(i.price||0)*Number(i.quantity||0),i.grossProfit??"",inv.total])));
 const csv=rows.map(r=>r.map(v=>'"'+String(v??"").replace(/"/g,'""')+'"').join(",")).join("\n");
 const blob=new Blob(["\\uFEFF"+csv],{type:"text/csv;charset=utf-8"}),url=URL.createObjectURL(blob),a=document.createElement("a");a.href=url;a.download="MedStock-Sales-History.csv";a.click();URL.revokeObjectURL(url);
}
function renderMedicineIntelligence(){
 const groups=new Map();
 supplierOffers.forEach(o=>{const key=[o.medicine_name,o.composition,o.strength,o.dosage_form].map(v=>(v||"").trim().toLowerCase()).join("|");if(!groups.has(key))groups.set(key,[]);groups.get(key).push(o);});
 const all=[...groups.entries()].map(([key,offers])=>({key,offers,name:offers[0].medicine_name}));
 const term=($("intelligenceSearch")?.value||"").trim().toLowerCase(),sort=$("intelligenceSort")?.value||"name";
 const visible=all.filter(g=>g.offers.some(o=>{const s=suppliers.find(x=>x.id===o.supplier_id);return [o.medicine_name,o.composition,o.strength,o.dosage_form,o.manufacturer,s?.name].join(" ").toLowerCase().includes(term);}));
 visible.sort((a,b)=>{if(sort==="price")return Math.min(...a.offers.map(x=>Number(x.purchase_price)))-Math.min(...b.offers.map(x=>Number(x.purchase_price)));if(sort==="expiry")return Math.min(...a.offers.map(x=>new Date(x.expiry_date).getTime()))-Math.min(...b.offers.map(x=>new Date(x.expiry_date).getTime()));return a.name.localeCompare(b.name);});
 $("intelOfferCount").textContent=supplierOffers.length;$("intelGroupCount").textContent=all.length;$("intelMultiCount").textContent=all.filter(g=>g.offers.length>1).length;
 $("intelVerifiedCount").textContent=supplierOffers.filter(o=>suppliers.find(s=>s.id===o.supplier_id)?.verification_status==="verified").length;
 $("intelligenceGroups").innerHTML=visible.map(g=>{
  const offers=[...g.offers].sort((a,b)=>Number(a.purchase_price)-Number(b.purchase_price));
  const rows=offers.map(o=>{const s=suppliers.find(x=>x.id===o.supplier_id)||{};const days=Math.ceil((new Date(o.expiry_date+"T00:00:00")-new Date(todayString+"T00:00:00"))/86400000);return `<tr><td>${esc(s.name||"Unknown supplier")}${s.verification_status==="verified"?' <span class="status safe">Verified</span>':' <span class="status warning">Not verified</span>'}</td><td>${esc(o.manufacturer||"—")}</td><td>${esc(o.pack_size)}</td><td><strong>${money(o.purchase_price)}</strong></td><td>${Number(o.available_stock)}</td><td>${esc(o.expiry_date)} (${days<0?"expired":days+" days"})</td><td>${esc(o.decision_status||"pending")}</td></tr>`;}).join("");
  return `<article class="intelligence-card"><div class="intelligence-card-head"><div><h3>${esc(g.name)}</h3><p>${esc(offers[0].composition)} · ${esc(offers[0].strength)} · ${esc(offers[0].dosage_form)}</p></div><span class="status ${offers.length>1?"safe":"warning"}">${offers.length} offer${offers.length===1?"":"s"}</span></div><div class="table-wrap"><table><thead><tr><th>Supplier</th><th>Manufacturer</th><th>Pack size</th><th>Pack price</th><th>Stock</th><th>Expiry</th><th>Decision</th></tr></thead><tbody>${rows}</tbody></table></div><p class="tiny muted">Offers are grouped only when medicine name, composition, strength and dosage form match exactly as entered. Verify source documents and packaging before purchase.</p></article>`;
 }).join("")||'<p class="muted">No matching supplier offers. Add offers in Supplier Management to compare them here.</p>';
}


function purchaseOfferScore(o){
 const supplier=suppliers.find(s=>s.id===o.supplier_id)||{},days=Math.ceil((new Date((o.expiry_date||"1970-01-01")+"T00:00:00")-new Date(todayString+"T00:00:00"))/86400000);
 const peers=supplierOffers.filter(x=>[x.medicine_name,x.composition,x.strength,x.dosage_form].every((v,i)=>String(v||"").trim().toLowerCase()===[o.medicine_name,o.composition,o.strength,o.dosage_form][i].trim().toLowerCase()));
 const prices=peers.map(x=>Number(x.purchase_price)),min=Math.min(...prices),max=Math.max(...prices);
 const priceScore=max===min?1:(max-Number(o.purchase_price))/(max-min);
 const expiryScore=days<0?0:Math.min(days/365,1),stockScore=Math.min(Number(o.available_stock)/Math.max(1,Number(o.minimum_order_qty||1)*5),1);
 const verified=supplier.verification_status==="verified"?1:0;
 const score=priceScore*35+expiryScore*20+stockScore*15+verified*30;
 return {score,days,supplier,priceScore,expiryScore,stockScore,verified};
}
function renderAIInsights(){
 if(!$("aiPriorityList"))return;
 const low=medicines.filter(x=>x.quantity<=x.minimum&&daysLeft(x)>=0).sort((a,b)=>(a.quantity-a.minimum)-(b.quantity-b.minimum));
 const risk=medicines.filter(x=>daysLeft(x)<=60),riskValue=risk.reduce((a,x)=>a+x.quantity*x.purchase,0);
 const pending=supplierOffers.filter(x=>(x.decision_status||"pending")==="pending");
 $("aiLowStock").textContent=low.length;$("aiExpiryRisk").textContent=risk.length;$("aiExpiryValue").textContent=money(riskValue);$("aiOffersReview").textContent=pending.length;
 const actions=[];
 low.slice(0,5).forEach(x=>actions.push({type:"Stock",title:x.name+" needs review",desc:x.quantity+" units left against minimum "+x.minimum+". Suggested top-up: "+Math.max(0,x.minimum*2-x.quantity)+" units.",priority:"High"}));
 risk.slice(0,5).forEach(x=>actions.push({type:daysLeft(x)<0?"Expired":"Expiry",title:x.name+" · batch "+x.batch,desc:(daysLeft(x)<0?"Expired "+Math.abs(daysLeft(x))+" days ago": "Expires in "+daysLeft(x)+" days")+" · "+x.quantity+" units · purchase value "+money(x.quantity*x.purchase)+".",priority:daysLeft(x)<0?"Urgent":"Review"}));
 if(!actions.length)actions.push({type:"Clear",title:"No urgent stock or expiry alerts",desc:"Your current stock and expiry records do not show these priority conditions.",priority:"Good"});
 $("aiPriorityList").innerHTML=actions.map(x=>`<article class="insight-row"><span class="insight-tag">${esc(x.type)}</span><div><strong>${esc(x.title)}</strong><p>${esc(x.desc)}</p></div><span class="status ${x.priority==="Urgent"?"danger":x.priority==="Good"?"safe":"warning"}">${esc(x.priority)}</span></article>`).join("");
 const groups=new Map();supplierOffers.forEach(o=>{const k=[o.medicine_name,o.composition,o.strength,o.dosage_form].map(v=>String(v||"").trim().toLowerCase()).join("|");if(!groups.has(k))groups.set(k,[]);groups.get(k).push(o);});
 const picks=[...groups.values()].filter(a=>a.length>1).map(a=>a.map(o=>({o,...purchaseOfferScore(o)})).sort((x,y)=>y.score-x.score)[0]).sort((a,b)=>b.score-a.score).slice(0,6);
 $("aiPurchaseList").innerHTML=picks.map(x=>`<article class="insight-row"><span class="insight-tag">Top score</span><div><strong>${esc(x.o.medicine_name)} · ${esc(x.supplier.name||"Supplier")}</strong><p>${money(x.o.purchase_price)} pack · ${x.days} days to expiry · ${x.verified?"supplier marked verified":"supplier verification pending"} · score ${Math.round(x.score)}/100</p></div><span class="status ${x.verified&&x.days>90?"safe":"warning"}">${Math.round(x.score)}/100</span></article>`).join("")||'<p class="muted tiny">Add offers for the same medicine from at least two suppliers to see a side-by-side purchase ranking.</p>';
 const reorder=low.sort((a,b)=>(a.quantity/a.minimum)-(b.quantity/b.minimum));
 $("aiReorderTable").innerHTML=reorder.map(x=>`<tr><td><strong>${esc(x.name)}</strong></td><td>${esc(x.batch)}</td><td>${x.quantity}</td><td>${x.minimum}</td><td><strong>${Math.max(0,x.minimum*2-x.quantity)}</strong></td><td>${esc(x.expiry)}</td><td><span class="status danger">Reorder review</span></td></tr>`).join("")||'<tr><td colspan="7">No medicines currently below minimum stock.</td></tr>';
 $("aiOfferRanking").innerHTML=[...groups.values()].filter(a=>a.length>1).map(a=>{const ranked=a.map(o=>({o,...purchaseOfferScore(o)})).sort((x,y)=>y.score-x.score);return `<article class="insight-row"><div><strong>${esc(a[0].medicine_name)} — ${ranked.length} comparable offers</strong><p>${ranked.map((x,i)=>(i+1)+". "+esc(x.supplier.name||"Supplier")+" "+money(x.o.purchase_price)+" (score "+Math.round(x.score)+"/100)").join(" · ")}</p></div></article>`;}).join("")||'<p class="muted tiny">No comparable multi-supplier offers yet.</p>';
}
function exportReorderPlan(){
 const rows=[["Medicine","Batch","Available","Minimum","Suggested top-up","Expiry"],...medicines.filter(x=>x.quantity<=x.minimum&&daysLeft(x)>=0).map(x=>[x.name,x.batch,x.quantity,x.minimum,Math.max(0,x.minimum*2-x.quantity),x.expiry])];
 const csv=rows.map(r=>r.map(v=>'"'+String(v??"").replace(/"/g,'""')+'"').join(",")).join("\n"),blob=new Blob(["\\uFEFF"+csv],{type:"text/csv;charset=utf-8"}),url=URL.createObjectURL(blob),a=document.createElement("a");a.href=url;a.download="MedStock-Reorder-Plan.csv";a.click();URL.revokeObjectURL(url);
}


function demandRows(){
 const since=new Date(todayString+"T00:00:00");since.setDate(since.getDate()-29);const from=localDate(since),sold=new Map();let units=0;
 sales.filter(s=>s.date>=from&&s.date<=todayString).forEach(s=>(s.items||[]).forEach(i=>{const id=i.id||i.medicine_id;if(id){const q=Number(i.quantity||0);sold.set(id,(sold.get(id)||0)+q);units+=q;}}));
 return {units,rows:medicines.map(m=>{const count=sold.get(m.id)||0,rate=count/30,cover=rate?m.quantity/rate:Infinity,target=Math.ceil(rate*14);return {m,count,rate,cover,target,order:Math.max(0,Math.max(target,m.quantity<=m.minimum?m.minimum*2:0)-m.quantity)};})};
}
function renderDemandLab(){
 const d=demandRows(),active=d.rows.filter(x=>x.count>0),critical=d.rows.filter(x=>x.rate>0&&x.cover<7),value=d.rows.reduce((a,x)=>a+x.order*x.m.purchase,0);
 $("demandUnits").textContent=d.units;$("demandLines").textContent=active.length;$("demandStockouts").textContent=critical.length;$("demandValue").textContent=money(value);
 $("demandTable").innerHTML=[...d.rows].sort((a,b)=>a.cover-b.cover).map(x=>"<tr><td><b>"+esc(x.m.name)+"</b><small class='table-sub'>"+esc(x.m.batch)+"</small></td><td>"+x.m.quantity+"</td><td>"+x.count+"</td><td>"+x.rate.toFixed(2)+"</td><td>"+(Number.isFinite(x.cover)?x.cover.toFixed(1)+" days":"No velocity")+"</td><td>"+x.target+"</td><td><b>"+x.order+"</b></td><td>"+(x.rate&&x.cover<7?badge("Low Stock"):x.rate?badge("Available"):"<span class=\"status warning\">No recent sales</span>")+"</td></tr>").join("")||"<tr><td colspan='8'>Add inventory and record sales to activate forecasting.</td></tr>";
 const fast=d.rows.filter(x=>x.count>0&&x.cover<14).length,steady=d.rows.filter(x=>x.count>0&&x.cover>=14).length,none=d.rows.filter(x=>!x.count).length;
 $("velocityMix").innerHTML=[["Fast-moving / low cover",fast],["Demand with healthy cover",steady],["No sales in 30 days",none]].map(x=>"<div class='velocity-row'><span>"+x[0]+"</span><b>"+x[1]+"</b></div>").join("");
}
function riskRows(){
 const d=demandRows();return medicines.map(m=>{const days=daysLeft(m),sold=d.rows.find(x=>x.m.id===m.id)?.count||0;let risk="",advice="",rank=9;
 if(days<0){risk="Expired stock";advice="Quarantine from sale; follow approved return/disposal process.";rank=0;}
 else if(days<=30){risk="Critical expiry";advice="Review supplier return options and lawful stock handling.";rank=1;}
 else if(days<=90){risk="Near expiry";advice="Review FEFO rotation where appropriate.";rank=2;}
 else if(m.quantity>0&&!sold){risk="No recorded movement";advice="Check purchase history and shelf placement before reordering.";rank=3;}
 else if(m.price<m.purchase){risk="Negative unit margin";advice="Review selling price, discounts and recorded cost.";rank=4;}
 return risk?{m,days,risk,advice,rank,value:m.quantity*m.purchase}:null;}).filter(Boolean).sort((a,b)=>a.rank-b.rank||a.days-b.days);
}
function renderRiskRadar(){
 const r=riskRows(),expired=r.filter(x=>x.days<0),near=r.filter(x=>x.days>=0&&x.days<=90),slow=r.filter(x=>x.risk==="No recorded movement"),margin=r.filter(x=>x.risk==="Negative unit margin");
 $("radarExpired").textContent=money(expired.reduce((a,x)=>a+x.value,0));$("radarNear").textContent=money(near.reduce((a,x)=>a+x.value,0));$("radarSlow").textContent=slow.length;$("radarMargin").textContent=margin.length;
 $("riskRegister").innerHTML=r.map(x=>"<tr><td><span class='risk-label risk-"+x.rank+"'>"+esc(x.risk)+"</span></td><td><b>"+esc(x.m.name)+"</b><small class='table-sub'>"+esc(x.m.batch)+"</small></td><td>"+x.m.quantity+"</td><td>"+esc(x.m.expiry)+"</td><td>"+money(x.value)+"</td><td>"+esc(x.advice)+"</td></tr>").join("")||"<tr><td colspan='6'>No risk signals detected in current records.</td></tr>";
 const scores=suppliers.map(s=>{const offers=supplierOffers.filter(o=>o.supplier_id===s.id),verified=s.verification_status==="verified",fresh=offers.filter(o=>Math.ceil((new Date(o.expiry_date+"T00:00:00")-new Date(todayString+"T00:00:00"))/86400000)>90).length,score=Math.round((verified?50:0)+(offers.length?25:0)+(offers.length?25*fresh/offers.length:0));return {s,offers:offers.length,score};}).sort((a,b)=>b.score-a.score);
 $("supplierRadar").innerHTML=scores.map(x=>"<article class='supplier-score'><div class='supplier-score-head'><div><b>"+esc(x.s.name)+"</b><small>"+x.offers+" offers · "+esc(x.s.verification_status||"pending")+" status</small></div><strong>"+x.score+"/100</strong></div><div class='score-track'><span style='width:"+x.score+"%'></span></div><small class='muted'>Score reflects recorded verification, offer coverage and expiry horizon only.</small></article>").join("")||"<p class='muted'>Add suppliers and offers to build this index.</p>";
}
function renderCommandCenter(){
 const inv=medicines.reduce((a,x)=>a+x.quantity*x.purchase,0),month=todayString.slice(0,7),rev=sales.filter(x=>(x.date||"").slice(0,7)===month).reduce((a,x)=>a+x.total,0),risk=riskRows(),cash=risk.filter(x=>x.days<=90).reduce((a,x)=>a+x.value,0),critical=medicines.filter(x=>x.quantity<=x.minimum||daysLeft(x)<=30).length;
 $("capitalValue").textContent=money(inv);$("monthRevenue").textContent=money(rev);$("riskCapital").textContent=money(cash);$("criticalBatches").textContent=critical;
 const acts=risk.slice(0,3).map(x=>({tag:x.risk,title:x.m.name+" · "+x.m.batch,desc:x.advice,page:"riskRadar"})).concat(demandRows().rows.filter(x=>x.rate>0&&x.cover<7).slice(0,2).map(x=>({tag:"Stockout watch",title:x.m.name+" may run out soon",desc:"Estimated cover "+x.cover.toFixed(1)+" days from recorded sales.",page:"demandLab"})));
 $("commandActions").innerHTML=acts.slice(0,4).map(x=>"<article class='command-action'><span class='action-orb'>!</span><div><span class='eyebrow'>"+esc(x.tag)+"</span><b>"+esc(x.title)+"</b><p>"+esc(x.desc)+"</p></div><button class='text-btn' onclick='showPage(&quot;"+x.page+"&quot;)'>Review →</button></article>").join("")||"<p class='muted'>No priority actions. Add stock and sales records to unlock operational signals.</p>";
}
function exportRiskRegister(){
 const rows=[["Risk","Medicine","Batch","Units","Expiry","Purchase Value","Review"]].concat(riskRows().map(x=>[x.risk,x.m.name,x.m.batch,x.m.quantity,x.m.expiry,x.value,x.advice]));
 const csv=rows.map(r=>r.map(v=>'"'+String(v??"").replace(/"/g,'""')+'"').join(",")).join("\n"),blob=new Blob(["\\uFEFF"+csv],{type:"text/csv;charset=utf-8"}),url=URL.createObjectURL(blob),a=document.createElement("a");a.href=url;a.download="MedStock-Risk-Register.csv";a.click();URL.revokeObjectURL(url);
}

function updateReports(){const revenue=sales.reduce((a,x)=>a+x.total,0),value=medicines.reduce((a,x)=>a+x.quantity*x.purchase,0),low=medicines.filter(x=>x.quantity<=x.minimum&&daysLeft(x)>=0).length;$("reportRevenue").textContent=money(revenue);$("reportInvoices").textContent=sales.length;$("inventoryValue").textContent=money(value);$("reportLow").textContent=low;$("reportTable").innerHTML=sales.map(x=>`<tr><td>${esc(x.id)}</td><td>${esc(x.customer)}</td><td>${esc(x.date)}</td><td>${x.items.length}</td><td>${money(x.total)}</td></tr>`).join("")||'<tr><td colspan="5">No reports available yet.</td></tr>';}
function exportReport(){const rows=[["Invoice","Customer","Date","Total"],...sales.map(x=>[x.id,x.customer,x.date,x.total])];const csv=rows.map(r=>r.map(v=>'"'+String(v).replace(/"/g,'""')+'"').join(",")).join("\n");const blob=new Blob(["\uFEFF"+csv],{type:"text/csv;charset=utf-8"}),url=URL.createObjectURL(blob),a=document.createElement("a");a.href=url;a.download="MedStock-Sales-Report.csv";a.click();URL.revokeObjectURL(url);}
function updateChart(){const canvas=$("salesChart");if(!canvas||!window.Chart)return;const labels=[],values=[];for(let i=6;i>=0;i--){const d=new Date();d.setDate(d.getDate()-i);const ds=localDate(d);labels.push(d.toLocaleDateString("en-IN",{day:"numeric",month:"short"}));values.push(sales.filter(x=>x.date===ds).reduce((a,x)=>a+x.total,0));}if(salesChart)salesChart.destroy();salesChart=new Chart(canvas,{type:"bar",data:{labels,datasets:[{label:"Sales (₹)",data:values,backgroundColor:"#3d91d3",borderRadius:6,maxBarThickness:35}]},options:{responsive:true,plugins:{legend:{display:false}},scales:{y:{beginAtZero:true,ticks:{callback:v=>"₹"+v}}}}});}
function closeModal(id){$(id).classList.remove("show");}
document.querySelectorAll(".modal").forEach(m=>m.addEventListener("click",e=>{if(e.target===m)m.classList.remove("show");}));

function renderAdvancedSuite(){
 const opts=suppliers.map(s=>'<option value="'+s.id+'">'+esc(s.name)+'</option>').join("");
 if($("poSupplier")){const cur=$("poSupplier").value;$("poSupplier").innerHTML='<option value="">Choose supplier</option>'+opts;if(cur)$("poSupplier").value=cur;}
 renderPODraft();renderPORegister();renderTraceLedger();
}
function renderPODraft(){
 if(!$("poDraftLines"))return;
 const rows=demandRows().rows.filter(x=>x.order>0);
 $("poDraftLines").innerHTML=rows.map(x=>'<tr><td><input type="checkbox" class="po-include" data-id="'+x.m.id+'" checked></td><td><b>'+esc(x.m.name)+'</b><small class="table-sub">Batch '+esc(x.m.batch)+'</small></td><td>'+x.m.quantity+'</td><td>'+x.order+'</td><td><input class="po-qty" data-id="'+x.m.id+'" type="number" min="1" value="'+x.order+'" style="width:82px"></td><td>'+money(x.m.purchase)+'</td><td class="po-line-total" data-id="'+x.m.id+'">'+money(x.order*x.m.purchase)+'</td></tr>').join("")||'<tr><td colspan="7">No reorder suggestions right now. Demand estimates need recorded sales.</td></tr>';
 document.querySelectorAll(".po-qty,.po-include").forEach(el=>el.addEventListener("change",updatePOTotal));updatePOTotal();
}
function updatePOTotal(){let total=0;document.querySelectorAll(".po-qty").forEach(el=>{const id=el.dataset.id,include=document.querySelector('.po-include[data-id="'+id+'"]')?.checked,m=medicines.find(x=>x.id===id);if(include&&m)total+=Math.max(0,Number(el.value)||0)*m.purchase;});if($("poDraftTotal"))$("poDraftTotal").textContent=money(total);}
async function createPurchaseOrder(){
 if(window.medstockAdvancedTablesMissing){toast("Run the latest database.sql in Supabase to activate purchase orders.");return;}
 const supplierId=$("poSupplier").value;if(!supplierId){toast("Choose a supplier first.");return;}
 const items=[...document.querySelectorAll(".po-qty")].filter(el=>document.querySelector('.po-include[data-id="'+el.dataset.id+'"]')?.checked).map(el=>{const m=medicines.find(x=>x.id===el.dataset.id);return m?{medicine_id:m.id,name:m.name,batch:m.batch,barcode:m.barcode||"",quantity:Math.max(1,Math.floor(Number(el.value)||1)),unit_cost:m.purchase,purchase_price:m.purchase,selling_price:m.price,category:m.category,manufacturer:m.manufacturer,minimum:m.minimum,manufacture:m.manufacture,expiry:m.expiry}:null;}).filter(Boolean);
 if(!items.length){toast("Select at least one reorder line.");return;}
 const total=items.reduce((a,x)=>a+x.quantity*x.unit_cost,0),poNo="PO-"+Date.now();
 const {error}=await db.from("purchase_orders").insert({user_id:currentUser.id,po_number:poNo,supplier_id:supplierId,status:"sent",items,total,notes:$("poNotes").value.trim()});
 if(error){toast("Purchase order could not be saved. Run the latest database.sql in Supabase. "+error.message);return;}
 await loadAll();renderAdvancedSuite();toast("Purchase order "+poNo+" created.");
}
async function receivePurchaseOrder(id){
 const po=purchaseOrders.find(x=>x.id===id);if(window.medstockAdvancedTablesMissing){toast("Run the latest database.sql in Supabase first.");return;}if(!po||po.status!=="sent")return;
 if(!confirm("Start goods receipt? Confirm the actual batch number, expiry and barcode printed on every delivered pack."))return;
 const receipts=[];
 for(const line of po.items||[]){
  const actualBatch=prompt("Actual delivered batch / lot for "+line.name,line.batch||"");if(actualBatch===null)return;
  const actualExpiry=prompt("Actual expiry date (YYYY-MM-DD) for "+line.name,line.expiry||"");if(actualExpiry===null)return;
  const actualBarcode=prompt("Actual barcode / GTIN (leave blank if not printed) for "+line.name,line.barcode||"");if(actualBarcode===null)return;
  if(!actualBatch.trim()||!/^\\d{4}-\\d{2}-\\d{2}$/.test(actualExpiry)||actualExpiry<todayString){toast("Receipt stopped: enter a valid, non-expired batch expiry date.");return;}
  receipts.push({...line,actualBatch:actualBatch.trim(),actualExpiry,actualBarcode:actualBarcode.trim()});
 }
 try{
  for(const line of receipts){
   let target=medicines.find(m=>m.name.toLowerCase()===line.name.toLowerCase()&&m.batch.toLowerCase()===line.actualBatch.toLowerCase());
   if(target){const {error}=await db.from("medicines").update({quantity:target.quantity+Number(line.quantity),barcode:line.actualBarcode||target.barcode||""}).eq("id",target.id);if(error)throw error;}
   else{const created=await db.from("medicines").insert({user_id:currentUser.id,name:line.name,category:line.category||"Other",batch:line.actualBatch,manufacturer:line.manufacturer||"",purchase:Number(line.purchase_price||0),price:Number(line.selling_price||0),quantity:Number(line.quantity),minimum:Number(line.minimum||1),manufacture:line.manufacture||null,expiry:line.actualExpiry,barcode:line.actualBarcode}).select().single();if(created.error)throw created.error;target=created.data;}
   const mv=await db.from("stock_movements").insert({user_id:currentUser.id,medicine_id:target?.id,medicine_name:line.name,batch:line.actualBatch,barcode:line.actualBarcode,movement_type:"RECEIVED",quantity:Number(line.quantity),reference:po.po_number,notes:"Goods receipt; actual batch and expiry confirmed"});
   if(mv.error)throw mv.error;
  }
  const {error}=await db.from("purchase_orders").update({status:"received",received_at:new Date().toISOString()}).eq("id",id);if(error)throw error;
  await loadAll();refreshAll();toast("Goods received. Actual batch details were saved.");
 }catch(e){toast("Receipt may be partially processed: "+e.message+". Inspect the batch ledger before retrying.");await loadAll();refreshAll();}
}
async function cancelPurchaseOrder(id){if(!confirm("Cancel this purchase order?"))return;const {error}=await db.from("purchase_orders").update({status:"cancelled"}).eq("id",id);if(error){toast(error.message);return;}await loadAll();refreshAll();toast("Purchase order cancelled.");}
function renderPORegister(){
 if(!$("poRegister"))return;if(window.medstockAdvancedTablesMissing){$("poRegister").innerHTML='<tr><td colspan="7">Run the latest database.sql in Supabase to activate purchase orders.</td></tr>';return;}
 $("poRegister").innerHTML=purchaseOrders.map(p=>{const s=suppliers.find(x=>x.id===p.supplier_id);return '<tr><td><b>'+esc(p.po_number)+'</b></td><td>'+esc(s?.name||"Supplier unavailable")+'</td><td>'+esc((p.created_at||"").slice(0,10))+'</td><td>'+(p.items||[]).length+'</td><td>'+money(p.total)+'</td><td>'+badge(p.status==="received"?"Available":p.status==="cancelled"?"Expired":"Low Stock")+'</td><td>'+(p.status==="sent"?'<button class="action-btn edit-btn" onclick="receivePurchaseOrder(\''+p.id+'\')">Receive</button> <button class="action-btn delete-btn" onclick="cancelPurchaseOrder(\''+p.id+'\')">Cancel</button>':"—")+'</td></tr>';}).join("")||'<tr><td colspan="7">No purchase orders yet.</td></tr>';
}
function exportPurchaseOrders(){const rows=[["PO","Supplier","Date","Status","Total","Items"]].concat(purchaseOrders.map(p=>[p.po_number,suppliers.find(s=>s.id===p.supplier_id)?.name||"",p.created_at,p.status,p.total,(p.items||[]).map(x=>x.name+" x "+x.quantity).join("; ")]));downloadCSV("MedStock-Purchase-Orders.csv",rows);}
function renderTraceLedger(){
 if(!$("traceLedger"))return;if(window.medstockAdvancedTablesMissing){$("traceLedger").innerHTML='<tr><td colspan="8">Run the latest database.sql in Supabase to activate the stock movement ledger.</td></tr>';return;}
 const term=($("traceSearch")?.value||"").toLowerCase(),type=$("traceType")?.value||"",rows=stockMovements.filter(m=>(!type||m.movement_type===type)&&[m.medicine_name,m.batch,m.barcode,m.reference,m.movement_type].join(" ").toLowerCase().includes(term));
 $("traceBatches").textContent=new Set(medicines.map(m=>m.id)).size;$("traceMovements").textContent=stockMovements.length;$("traceCoverage").textContent=(medicines.length?Math.round(100*medicines.filter(m=>m.barcode).length/medicines.length):0)+"%";$("traceUnits").textContent=stockMovements.reduce((a,x)=>a+Math.abs(Number(x.quantity)||0),0);
 $("traceLedger").innerHTML=rows.map(m=>'<tr><td>'+esc((m.created_at||"").replace("T"," ").slice(0,16))+'</td><td>'+esc(m.medicine_name)+'</td><td>'+esc(m.batch)+'</td><td>'+esc(m.barcode||"—")+'</td><td>'+esc(m.movement_type)+'</td><td>'+m.quantity+'</td><td>'+esc(m.reference)+'</td><td>'+esc(m.notes)+'</td></tr>').join("")||'<tr><td colspan="8">No stock movements recorded yet. New receipts and sales will appear here.</td></tr>';
}
function downloadCSV(name,rows){const csv=rows.map(r=>r.map(v=>'"'+String(v??"").replace(/"/g,'""')+'"').join(",")).join("\n"),blob=new Blob(["\\uFEFF"+csv],{type:"text/csv;charset=utf-8"}),url=URL.createObjectURL(blob),a=document.createElement("a");a.href=url;a.download=name;a.click();URL.revokeObjectURL(url);}
function exportTraceLedger(){downloadCSV("MedStock-Batch-Ledger.csv",[["Date","Medicine","Batch","Barcode","Movement","Quantity","Reference","Notes"],...stockMovements.map(m=>[m.created_at,m.medicine_name,m.batch,m.barcode,m.movement_type,m.quantity,m.reference,m.notes])]);}
function lookupBarcode(){
 const code=$("barcodeLookup").value.trim(),matches=medicines.filter(m=>m.barcode&&m.barcode.trim()===code);
 $("barcodeResult").innerHTML=matches.length?matches.map(m=>'<article class="barcode-hit"><b>'+esc(m.name)+'</b><p>Batch '+esc(m.batch)+' · '+m.quantity+' units · Expiry '+esc(m.expiry)+'</p><p>Barcode '+esc(m.barcode)+' · '+badge(status(m))+'</p><button class="secondary-btn" onclick="editMedicine(\''+m.id+'\')">Edit batch</button></article>').join(""):'<p class="muted">No exact barcode match found. Check the printed GTIN and ensure it is saved in this batch record.</p>';
}
async function startBarcodeScanner(){
 if(!("BarcodeDetector" in window)){toast("This browser does not support native barcode scanning. Use manual barcode entry.");return;}
 try{barcodeStream=await navigator.mediaDevices.getUserMedia({video:{facingMode:{ideal:"environment"}},audio:false});const v=$("barcodeVideo");v.srcObject=barcodeStream;await v.play();const detector=new BarcodeDetector({formats:["ean_13","ean_8","upc_a","upc_e","code_128","itf","qr_code"]});
 const scan=async()=>{if(!barcodeStream)return;try{const codes=await detector.detect(v);if(codes.length){$("barcodeLookup").value=codes[0].rawValue;lookupBarcode();stopBarcodeScanner();toast("Barcode captured.");return;}}catch(e){}barcodeFrame=requestAnimationFrame(scan);};scan();
 }catch(e){toast("Camera unavailable or permission denied: "+e.message);}
}
function stopBarcodeScanner(){if(barcodeFrame)cancelAnimationFrame(barcodeFrame);barcodeFrame=null;if(barcodeStream)barcodeStream.getTracks().forEach(t=>t.stop());barcodeStream=null;const v=$("barcodeVideo");if(v)v.srcObject=null;}
function askCopilot(question){
 const q=(question||$("copilotQuestion").value||"").trim();if(!q)return;
 const box=$("copilotConversation");const user=document.createElement("div");user.className="copilot-message user";user.textContent=q;box.appendChild(user);
 const t=q.toLowerCase(),low=medicines.filter(m=>m.quantity<=m.minimum&&daysLeft(m)>=0),expired=medicines.filter(m=>daysLeft(m)<0),near=medicines.filter(m=>daysLeft(m)>=0&&daysLeft(m)<=60),noMove=demandRows().rows.filter(x=>x.count===0),openPO=purchaseOrders.filter(p=>p.status==="sent");
 let answer="";
 if(/stockout|low stock|reorder|running out/.test(t)){const list=low.map(m=>m.name+" (batch "+m.batch+"): "+m.quantity+" left; minimum "+m.minimum).join("\n");answer=list||"No batches are currently below their configured minimum stock level.";}
 else if(/expir|expiry|expired/.test(t)){const list=[...expired,...near].map(m=>m.name+" / "+m.batch+": "+(daysLeft(m)<0?"expired "+Math.abs(daysLeft(m))+" days ago":"expires in "+daysLeft(m)+" days")+"; "+m.quantity+" units").join("\n");answer=list||"No expired or 60-day expiry-risk batches found in the current records.";}
 else if(/supplier|offer|price/.test(t)){answer=supplierOffers.slice(0,15).map(o=>{const s=suppliers.find(x=>x.id===o.supplier_id);return o.medicine_name+" — "+(s?.name||"Supplier")+": "+money(o.purchase_price)+"; "+o.available_stock+" stock; expiry "+o.expiry_date+"; "+o.decision_status;}).join("\n")||"No supplier offers have been recorded yet.";}
 else if(/slow|movement|not sell|stagnant/.test(t)){answer=noMove.slice(0,20).map(x=>x.m.name+" / "+x.m.batch+": "+x.m.quantity+" units; no recorded sales in the last 30 days").join("\n")||"Every recorded batch has sales activity in the 30-day window.";}
 else if(/sales|revenue|income/.test(t)){const rev=sales.reduce((a,x)=>a+x.total,0);answer="Recorded revenue across "+sales.length+" invoices: "+money(rev)+". Today: "+money(sales.filter(x=>x.date===todayString).reduce((a,x)=>a+x.total,0))+".";}
 else if(/purchase order|orders|procurement/.test(t)){answer=openPO.length+" purchase orders are awaiting receipt. Total open value: "+money(openPO.reduce((a,p)=>a+Number(p.total),0))+".";}
 else if(/supplier count|how many supplier/.test(t)){answer="You have "+suppliers.length+" suppliers and "+supplierOffers.length+" recorded offers.";}
 else {answer="I can inspect stockout risk, expiry exposure, supplier offers, slow-moving batches, recorded sales and purchase orders. Try asking one of those questions. I cannot advise on patient treatment or confirm medicine authenticity.";}
 const reply=document.createElement("div");reply.className="copilot-message assistant";reply.textContent=answer;box.appendChild(reply);box.scrollTop=box.scrollHeight;$("copilotQuestion").value="";
}
$("copilotForm").addEventListener("submit",e=>{e.preventDefault();askCopilot();});
$("traceSearch").addEventListener("input",renderTraceLedger);$("traceType").addEventListener("change",renderTraceLedger);
$("poSupplier").addEventListener("change",renderPODraft);

function refreshAll(){renderAdvancedSuite();renderCommandCenter();renderDemandLab();renderRiskRadar();updateDashboard();renderInventory();renderExpiry();renderSaleOptions();renderCart();renderSales();renderSuppliers();renderSalesHistory();renderMedicineIntelligence();renderAIInsights();updateReports();}
$("addCartBtn").onclick=addToCart;$("completeSaleBtn").onclick=completeSale;$("exportBtn").onclick=exportReport;
window.createPurchaseOrder=createPurchaseOrder;window.receivePurchaseOrder=receivePurchaseOrder;window.cancelPurchaseOrder=cancelPurchaseOrder;window.exportPurchaseOrders=exportPurchaseOrders;window.exportTraceLedger=exportTraceLedger;window.startBarcodeScanner=startBarcodeScanner;window.stopBarcodeScanner=stopBarcodeScanner;window.lookupBarcode=lookupBarcode;window.askCopilot=askCopilot;window.openMedicineForm=openMedicineForm;window.openSupplierForm=openSupplierForm;window.renderAIInsights=renderAIInsights;window.exportReorderPlan=exportReorderPlan;window.showPage=showPage;window.closeModal=closeModal;window.editMedicine=editMedicine;window.deleteMedicine=deleteMedicine;window.deleteSupplier=deleteSupplier;window.openOfferForm=openOfferForm;window.decideOffer=decideOffer;window.removeFromCart=removeFromCart;window.viewInvoice=viewInvoice;window.reprintHistoryInvoice=reprintHistoryInvoice;
document.addEventListener("DOMContentLoaded",init);
