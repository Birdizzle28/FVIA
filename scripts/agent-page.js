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
});
