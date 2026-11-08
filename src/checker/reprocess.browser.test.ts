import { chromium } from "playwright-core";
import { expect, it } from "vitest";

it.skipIf(!process.env.INVOICE_BROWSER_URL)("updates the current invoice after dev reprocessing", async () => {
  const browser = await chromium.launch({headless:true, executablePath:process.env.INVOICE_BROWSER_EXECUTABLE});
  try {
    const page=await browser.newPage();
    const origin=new URL(process.env.INVOICE_BROWSER_URL!).origin;
    const api=process.env.INVOICE_BROWSER_API ?? "http://127.0.0.1:8001";
    const oldId="11111111-1111-4111-8111-111111111111", newId=oldId;
    const old={id:oldId,project_id:"test",comparison_mode:"totals_only",filename:"test.pdf",status:"completed",mode:"live",created_at:"2026-11-08T08:00:00Z",updated_at:"2026-11-08T08:00:00Z",price_sheet_version:"",error:null,invoice:{supplier_name:null,invoice_number:"TEST",invoice_date:null,currency:null,subtotal:null,tax:"0",invoice_total:null,lines:[]},check:null,document:null};
    const fresh={...old,id:newId,created_at:"2026-11-08T09:00:00Z",updated_at:"2026-11-08T09:00:00Z",invoice:{...old.invoice,supplier_name:"Recovered supplier",currency:"SGD",subtotal:"598.72",invoice_total:"605.06",lines:[{part_number:"CK-PI4",description:"Recovered Raspberry Pi",quantity:"2",unit_price:"299.36",line_total:"598.72"}]}};
    let rows: unknown[]=[old];
    await page.route(`${api}/**`,async route=>{
      const req=route.request(),url=new URL(req.url());
      const headers={"access-control-allow-origin":origin,"access-control-allow-credentials":"true","access-control-allow-headers":"*"};
      const send=(body:unknown)=>route.fulfill({headers,json:body});
      if(req.method()==="OPTIONS")return route.fulfill({status:204,headers});
      if(url.pathname==="/auth/me")return send({authenticated:true,user:{email:"test@example.com",role:"member"}});
      if(url.pathname==="/projects")return send([{id:"test",name:"Test group",comparison_mode:"totals_only",created_at:old.created_at,has_master_list:false,invoice_count:rows.length,included_count:rows.length,excluded_count:0,totals:{}}]);
      if(url.pathname.endsWith("/file"))return route.fulfill({headers,body:"%PDF fixture"});
      if(url.pathname===`/invoices/${oldId}/reprocess` && req.method()==="POST"){
        await new Promise(resolve=>setTimeout(resolve,200));rows=[fresh];return route.fulfill({status:201,headers,json:fresh});
      }
      if(url.pathname==="/invoices")return send(rows);
      return send({});
    });
    await page.goto(`${origin}/invoices?project=test&group=Test+group&id=${oldId}&mode=dev`);
    const button=page.getByRole("button",{name:"Reprocess document",exact:true});
    await button.waitFor();
    let navigations = 0;
    page.on("framenavigated", frame => { if (frame === page.mainFrame()) ++navigations; });
    await button.click();
    await expect.poll(() => navigations).toBe(1);
    await expect.poll(()=>new URL(page.url()).searchParams.get("id"),{timeout:15000}).toBe(newId);
    await expect.poll(()=>page.locator('.ic-check').innerText()).toContain("Recovered Raspberry Pi");
    expect(new URL(page.url()).searchParams.get("mode")).toBe("dev");
  }finally{await browser.close();}
},45000);
