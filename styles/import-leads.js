.import-wrap{
  max-width:1100px;
  margin:24px auto;
  padding:0 16px;
  background:#f6f7fb;
}

.import-title{
  margin:12px 0 6px;
  font-size:clamp(24px,3.2vw,36px);
  color:#353468;
  font-weight:800;
}

.import-sub{
  margin:0 0 16px;
  color:#5b6474;
}

.card{
  background:#fff;
  border:1px solid #e9eaf0;
  border-radius:0;
  padding:14px;
  box-shadow:0 2px 10px rgba(0,0,0,.06);
  margin-bottom:14px;
}

.row{ display:flex; gap:10px; flex-wrap:wrap; align-items:center; }
.row.split{ margin-top:12px; display:grid; grid-template-columns:repeat(4,minmax(120px,1fr)); gap:10px; }

.file-btn{
  display:inline-flex;
  gap:8px;
  align-items:center;
  border:1px solid #d6d9e2;
  background:#f6f7fb;
  padding:10px 12px;
  cursor:pointer;
}
.file-btn input{ display:none; }

.btn{
  border:1px solid #d6d9e2;
  background:#f6f7fb;
  padding:10px 12px;
  cursor:pointer;
  border-radius:0;
}
.btn:disabled{ opacity:.55; cursor:not-allowed; }
.btn.primary{
  background:#2563eb;
  border-color:#2563eb;
  color:#fff;
}

.mini{ border:1px solid #eef0f6; padding:10px; background:#fafbff; }
.mini .k{ font-size:12px; color:#6b7280; }
.mini .v{ font-size:18px; font-weight:800; color:#0f172a; }
.mini .v.bad{ color:#b00020; }

.progress{
  margin-top:12px;
  width:100%;
  height:10px;
  border:1px solid #d6d9e2;
  background:#f6f7fb;
}
.bar{ height:100%; background:#353468; }

.status{
  margin-top:10px;
  color:#353468;
  font-weight:700;
}

.h2{ margin:0 0 10px; color:#353468; }

.maplist{ margin:0; padding-left:18px; color:#5b6474; }

.table-wrap{ overflow:auto; border:1px solid #eef0f6; }
table.preview{ width:100%; border-collapse:collapse; font-size:14px; }
.preview th, .preview td{
  border-bottom:1px solid #eef0f6;
  padding:8px;
  text-align:left;
  vertical-align:top;
  white-space:nowrap;
}
.preview th{ background:#f9fafe; color:#353468; position:sticky; top:0; }
