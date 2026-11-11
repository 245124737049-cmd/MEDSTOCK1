/* MedStock cloud app. Requires config.js values and database.sql setup. */
let db = null, currentUser = null, medicines = [], suppliers = [], sales = [], supplierOffers = [], cart = [], salesChart = null;
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
  const [m,s,sa,so]=await Promise.all([
    db.from("medicines").select("*").order("created_at",{ascending:true}),
    db.from("suppliers").select("*").order("created_at",{ascending:true}),
    db.from("sales").select("*").order("created_at",{ascending:false}),
    db.from("supplier_offers").select("*").order("created_at",{ascending:false})
  ]);
  if(m.error)throw m.error;if(s.error)throw s.error;if(sa.error)throw sa.error;if(so.error)throw so.error;
  medicines=(m.data||[]).map(x=>({...x,manufacture:x.manufacture||"",minimum:Number(x.minimum),quantity:Number(x.quantity),price:Number(x.price),purchase:Number(x.purchase)}));
  suppliers=s.data||[];supplierOffers=so.data||[];sales=(sa.data||[]).map(x=>({id:x.invoice_no,customer:x.customer,date:x.sale_date,items:x.items||[],total:Number(x.total)}));
}
async function saveMedicine(record,id){
  const payload={user_id:currentUser.id,name:record.name,category:record.category,batch:record.batch,manufacturer:record.manufacturer,purchase:record.purchase,price:record.price,quantity:record.quantity,minimum:record.minimum,manufacture:record.manufacture||null,expiry:record.expiry};
  const q=id?db.from("medicines").update(payload).eq("id",id):db.from("medicines").insert(payload).select().single();
  const {data,error}=await q;if(error)throw error;return data;
}
function showPage(page){
  document.querySelectorAll(".page").forEach(x=>x.classList.remove("active-page"));$(page).classList.add("active-page");
  document.querySelectorAll(".nav-link").forEach(x=>x.classList.toggle("active",x.dataset.page===page));
  const titles={dashboard:"Dashboard",inventory:"Medicine Inventory",expiry:"Expiry Management",sales:"Sales & Billing",suppliers:"Suppliers",reports:"Reports & Analytics"};
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
 if(id){const x=medicines.find(m=>m.id===id);if(!x)return;$("medName").value=x.name;$("medCategory").value=x.category;$("medBatch").value=x.batch;$("medManufacturer").value=x.manufacturer;$("medPurchase").value=x.purchase;$("medPrice").value=x.price;$("medQuantity").value=x.quantity;$("medMinimum").value=x.minimum;$("medManufacture").value=x.manufacture||"";$("medExpiry").value=x.expiry;}
 $("medicineModal").classList.add("show");
}
function editMedicine(id){openMedicineForm(id);}
async function deleteMedicine(id){if(!confirm("Delete this medicine batch?"))return;try{const {error}=await db.from("medicines").delete().eq("id",id);if(error)throw error;await loadAll();refreshAll();toast("Medicine deleted.");}catch(e){toast(e.message);}}
$("medicineForm").addEventListener("submit",async e=>{
 e.preventDefault();const id=$("medicineId").value;
 const record={name:$("medName").value.trim(),category:$("medCategory").value,batch:$("medBatch").value.trim(),manufacturer:$("medManufacturer").value.trim(),purchase:Number($("medPurchase").value),price:Number($("medPrice").value),quantity:Number($("medQuantity").value),minimum:Number($("medMinimum").value),manufacture:$("medManufacture").value,expiry:$("medExpiry").value};
 if(Object.values(record).some(v=>v=== ""||v===null) || [record.purchase,record.price,record.quantity,record.minimum].some(v=>v<0)){toast("Please complete all required fields with valid values.");return;}
 if(record.expiry<todayString&&!confirm("This batch is already expired. Save for record keeping?"))return;
 try{await saveMedicine(record,id);await loadAll();closeModal("medicineModal");refreshAll();toast(id?"Medicine updated!":"Medicine added!");}catch(err){toast(err.message.includes("duplicate")?"This medicine batch already exists.":err.message);}
});
function renderExpiry(){const rows=medicines.filter(x=>daysLeft(x)<=30).sort((a,b)=>daysLeft(a)-daysLeft(b));$("expiryTable").innerHTML=rows.map(x=>{const d=daysLeft(x);return `<tr><td>${esc(x.name)}</td><td>${esc(x.batch)}</td><td>${x.quantity}</td><td>${esc(x.expiry)}</td><td>${d<0?Math.abs(d)+" days ago":d+" days"}</td><td>${badge(status(x))}</td></tr>`;}).join("")||'<tr><td colspan="6">No expiry alerts. Great job!</td></tr>';}
function renderSaleOptions(){const list=medicines.filter(x=>x.quantity>0&&daysLeft(x)>=0);$("saleMedicine").innerHTML=list.map(x=>`<option value="${x.id}">${esc(x.name)} - ${money(x.price)} (${x.quantity} available)</option>`).join("")||'<option value="">No available medicines</option>';}
function addToCart(){
 const id=$("saleMedicine").value,q=Number($("saleQuantity").value),x=medicines.find(m=>m.id===id);if(!x){toast("Please select a medicine.");return;}if(!Number.isInteger(q)||q<=0){toast("Enter a valid quantity.");return;}
 const old=cart.find(c=>c.id===id),already=old?old.quantity:0;if(already+q>x.quantity){toast("Not enough stock available.");return;}
 if(old)old.quantity+=q;else cart.push({id:x.id,name:x.name,price:x.price,quantity:q});$("saleQuantity").value=1;renderCart();
}
function removeFromCart(id){cart=cart.filter(x=>x.id!==id);renderCart();}
function renderCart(){$("cartItems").innerHTML=cart.map(x=>`<div class="cart-item"><span><strong>${esc(x.name)}</strong><br>${x.quantity} × ${money(x.price)}</span><span>${money(x.price*x.quantity)} <button class="remove-cart" onclick="removeFromCart('${x.id}')">✕</button></span></div>`).join("")||"No items added yet.";$("cartTotal").textContent=money(cart.reduce((a,x)=>a+x.price*x.quantity,0));}
async function completeSale(){
 if(!cart.length){toast("Add medicines to the cart first.");return;}
 for(const c of cart){const m=medicines.find(x=>x.id===c.id);if(!m||m.quantity<c.quantity||daysLeft(m)<0){toast("Stock changed or batch expired. Check your cart.");return;}}
 const total=cart.reduce((a,x)=>a+x.price*x.quantity,0),invoiceNo="INV-"+Date.now(),date=todayString,customer=$("customerName").value.trim()||"Walk-in Customer";
 try{
  // Update stock and insert invoice. For production/multiple cashiers, use a server-side database transaction/RPC.
  for(const c of cart){const m=medicines.find(x=>x.id===c.id);const {error}=await db.from("medicines").update({quantity:m.quantity-c.quantity}).eq("id",m.id);if(error)throw error;}
  const {error}=await db.from("sales").insert({user_id:currentUser.id,invoice_no:invoiceNo,customer,sale_date:date,items:cart,total});if(error)throw error;
  const invoice={id:invoiceNo,customer,date,items:cart.map(x=>({...x})),total};cart=[];$("customerName").value="";await loadAll();refreshAll();toast("Invoice generated.");printInvoice(invoice);
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
 $("offerTable").innerHTML=rows.map(o=>{const s=suppliers.find(x=>x.id===o.supplier_id)||{};const selected=o.decision_status==="selected",rejected=o.decision_status==="rejected";return `<tr class="${selected?"selected-offer":rejected?"rejected-offer":""}"><td><strong>${esc(o.medicine_name)}</strong></td><td>${esc(o.composition)}</td><td>${esc(o.strength)}</td><td>${esc(o.dosage_form)}</td><td>${esc(o.manufacturer||"—")}</td><td>${esc(o.pack_size)}</td><td><strong>${money(o.purchase_price)}</strong></td><td>${o.available_stock}</td><td>${esc(o.expiry_date)}</td><td>${esc(s.name||"Unknown")}${s.verification_status==="verified"?'<span class="verified-mark"> ✓ Verified</span>':""}</td><td>${bestIds.has(o.id)?'<span class="recommend-chip">Recommended</span>':'—'}</td><td>${selected?'<span class="status safe">Selected</span>':rejected?'<span class="status danger">Rejected</span>':`<button class="action-btn edit-btn" onclick="decideOffer('${o.id}','selected')">Select</button> <button class="action-btn delete-btn" onclick="decideOffer('${o.id}','rejected')">Reject</button>`}</td></tr>`;}).join("")||'<tr><td colspan="12">No medicine offers yet. Add suppliers and their medicine offers to compare.</td></tr>';
}
function openOfferForm(){if(!suppliers.length){toast("Add at least one supplier first.");openSupplierForm();return;}$("offerForm").reset();$("offerSupplier").innerHTML=suppliers.map(s=>`<option value="${s.id}">${esc(s.name)}${s.company?" — "+esc(s.company):""}</option>`).join("");$("offerExpiry").value="";$("offerModal").classList.add("show");}
$("offerForm").addEventListener("submit",async e=>{e.preventDefault();const payload={user_id:currentUser.id,supplier_id:$("offerSupplier").value,medicine_name:$("offerMedicine").value.trim(),composition:$("offerComposition").value.trim(),strength:$("offerStrength").value.trim(),dosage_form:$("offerFormType").value,manufacturer:$("offerManufacturer").value.trim(),pack_size:$("offerPack").value.trim(),purchase_price:Number($("offerPrice").value),available_stock:Number($("offerStock").value),expiry_date:$("offerExpiry").value,decision_status:"pending"};if(payload.purchase_price<0||payload.available_stock<0){toast("Price and stock cannot be negative.");return;}try{const {error}=await db.from("supplier_offers").insert(payload);if(error)throw error;await loadAll();closeModal("offerModal");refreshAll();toast("Supplier medicine offer saved.");}catch(err){toast("Could not save offer. Run the updated database.sql in Supabase. "+err.message);}});
async function decideOffer(id,decision){const chosen=supplierOffers.find(x=>x.id===id);if(!chosen)return;const same=supplierOffers.filter(x=>x.id!==id&&x.medicine_name.trim().toLowerCase()===chosen.medicine_name.trim().toLowerCase()&&x.strength.trim().toLowerCase()===chosen.strength.trim().toLowerCase()&&x.composition.trim().toLowerCase()===chosen.composition.trim().toLowerCase());if(decision==="selected"&&!confirm("Select this supplier and mark the other matching offers as rejected?"))return;if(decision==="rejected"&&!confirm("Reject this supplier offer? It will remain in your records."))return;try{if(decision==="selected"){for(const other of same){const {error}=await db.from("supplier_offers").update({decision_status:"rejected"}).eq("id",other.id);if(error)throw error;}}const {error}=await db.from("supplier_offers").update({decision_status:decision}).eq("id",id);if(error)throw error;await loadAll();renderSuppliers();toast(decision==="selected"?"Supplier selected; other matching offers rejected.":"Offer rejected and retained in records.");}catch(err){toast(err.message);}}
$("offerSearch").addEventListener("input",renderSuppliers);
function updateReports(){const revenue=sales.reduce((a,x)=>a+x.total,0),value=medicines.reduce((a,x)=>a+x.quantity*x.purchase,0),low=medicines.filter(x=>x.quantity<=x.minimum&&daysLeft(x)>=0).length;$("reportRevenue").textContent=money(revenue);$("reportInvoices").textContent=sales.length;$("inventoryValue").textContent=money(value);$("reportLow").textContent=low;$("reportTable").innerHTML=sales.map(x=>`<tr><td>${esc(x.id)}</td><td>${esc(x.customer)}</td><td>${esc(x.date)}</td><td>${x.items.length}</td><td>${money(x.total)}</td></tr>`).join("")||'<tr><td colspan="5">No reports available yet.</td></tr>';}
function exportReport(){const rows=[["Invoice","Customer","Date","Total"],...sales.map(x=>[x.id,x.customer,x.date,x.total])];const csv=rows.map(r=>r.map(v=>'"'+String(v).replace(/"/g,'""')+'"').join(",")).join("\n");const blob=new Blob(["\uFEFF"+csv],{type:"text/csv;charset=utf-8"}),url=URL.createObjectURL(blob),a=document.createElement("a");a.href=url;a.download="MedStock-Sales-Report.csv";a.click();URL.revokeObjectURL(url);}
function updateChart(){const canvas=$("salesChart");if(!canvas||!window.Chart)return;const labels=[],values=[];for(let i=6;i>=0;i--){const d=new Date();d.setDate(d.getDate()-i);const ds=localDate(d);labels.push(d.toLocaleDateString("en-IN",{day:"numeric",month:"short"}));values.push(sales.filter(x=>x.date===ds).reduce((a,x)=>a+x.total,0));}if(salesChart)salesChart.destroy();salesChart=new Chart(canvas,{type:"bar",data:{labels,datasets:[{label:"Sales (₹)",data:values,backgroundColor:"#3d91d3",borderRadius:6,maxBarThickness:35}]},options:{responsive:true,plugins:{legend:{display:false}},scales:{y:{beginAtZero:true,ticks:{callback:v=>"₹"+v}}}}});}
function closeModal(id){$(id).classList.remove("show");}
document.querySelectorAll(".modal").forEach(m=>m.addEventListener("click",e=>{if(e.target===m)m.classList.remove("show");}));
function refreshAll(){updateDashboard();renderInventory();renderExpiry();renderSaleOptions();renderCart();renderSales();renderSuppliers();updateReports();}
$("addCartBtn").onclick=addToCart;$("completeSaleBtn").onclick=completeSale;$("exportBtn").onclick=exportReport;
window.openMedicineForm=openMedicineForm;window.openSupplierForm=openSupplierForm;window.showPage=showPage;window.closeModal=closeModal;window.editMedicine=editMedicine;window.deleteMedicine=deleteMedicine;window.deleteSupplier=deleteSupplier;window.openOfferForm=openOfferForm;window.decideOffer=decideOffer;window.removeFromCart=removeFromCart;
document.addEventListener("DOMContentLoaded",init);
