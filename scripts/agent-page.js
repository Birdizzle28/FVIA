document.addEventListener("DOMContentLoaded", async () => {

  const supabase = window.supabase;
  if (!supabase) { 
    console.error("window.supabase missing"); return; 
  }
  
  const parts = window.location.pathname.split("/").filter(Boolean);
  const slug = (parts[0] === "a" && parts[1]) ? parts[1] : null;
  if (!slug) {
    console.error("Missing slug in URL"); return; 
  }
  
  const { data: agent, error } = await supabase
    .from("agent_public_profiles")
    .select("*")
    .eq("agent_slug", slug)
    .single();
  
  if (!agent || error || !agent.agent_page_enabled) {
    document.body.innerHTML = `
      <h2 style="text-align:center;margin-top:120px;">
        This agent page is not active.
      </h2>
    `;
    return;
  }
  
  document.getElementById("agent-name").textContent = `${agent.first_name} ${agent.last_name}`;
  document.getElementById("agent-bio").textContent = agent.bio || "";
  
  if (agent.profile_picture_url) {
    document.getElementById("agent-photo").src =
    agent.profile_picture_url;
  }
  
  if (agent.phone) {
    document.getElementById("agent-call").href =
    `tel:${agent.phone}`;
    document.getElementById("agent-text").href =
    `sms:${agent.phone}`;
  }
  
  if (agent.email) {
    document.getElementById("agent-email").href =
    `mailto:${agent.email}`;
  }

    // ===== Save Contact (vCard) =====
  const vcardBtn = document.getElementById("agent-vcard");
  if (vcardBtn) {
    vcardBtn.addEventListener("click", async () => {
      try {
        const fullName = `${agent.first_name || ""} ${agent.last_name || ""}`.trim();

        // Optional: include photo if we can fetch it (works if the image URL is public + CORS allows it)
        let photoBlock = "";
        if (agent.profile_picture_url) {
          try {
            const res = await fetch(agent.profile_picture_url, { mode: "cors" });
            if (res.ok) {
              const blob = await res.blob();
              const b64 = await new Promise((resolve, reject) => {
                const reader = new FileReader();
                reader.onload = () => resolve(String(reader.result).split(",")[1] || "");
                reader.onerror = reject;
                reader.readAsDataURL(blob);
              });

              if (b64) {
                // vCard 3.0 photo line (JPEG is most compatible)
                photoBlock = `\nPHOTO;ENCODING=b;TYPE=JPEG:${b64}`;
              }
            }
          } catch (_) {
            // If photo fetch fails, we still generate the vCard without the image.
          }
        }

        const vcard =
          `BEGIN:VCARD
          VERSION:3.0
          FN:${fullName}
          N:${agent.last_name || ""};${agent.first_name || ""};;;
          ORG:Family Values Group
          TITLE:Insurance Broker
          TEL;TYPE=CELL:${agent.phone || ""}
          EMAIL;TYPE=INTERNET:${agent.email || ""}${photoBlock}
          END:VCARD`;

        const blob = new Blob([vcard], { type: "text/vcard;charset=utf-8" });
        const url = URL.createObjectURL(blob);

        const a = document.createElement("a");
        a.href = url;
        a.download = `${(agent.first_name || "agent")}-${(agent.last_name || "contact")}.vcf`;
        document.body.appendChild(a);
        a.click();
        a.remove();

        URL.revokeObjectURL(url);
      } catch (err) {
        console.error("vCard error:", err);
        alert("Could not generate contact card. Please try again.");
      }
    });
  }
});
