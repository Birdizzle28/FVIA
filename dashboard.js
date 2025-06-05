alert("✅ Inline script is working.");
    alert("✅ INLINE SCRIPT EXECUTED");
    import { createClient } from 'https://cdn.jsdelivr.net/npm/@supabase/supabase-js/+esm';
    
    const supabase = createClient(
      'https://ddlbgkolnayqrxslzsxn.supabase.co',
      'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImRkbGJna29sbmF5cXJ4c2x6c3huIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NDg4Mjg0OTQsImV4cCI6MjA2NDQwNDQ5NH0.-L0N2cuh0g-6ymDyClQbM8aAuldMQzOb3SXV5TDT5Ho'
    );
    
    document.addEventListener("DOMContentLoaded", async () => {
      alert("✅ DOM fully loaded and JS is running.");
      const loadingScreen = document.getElementById('loading-screen');
      
      try {
        alert("🔍 Checking session...");
        const sessionResult = await supabase.auth.getSession();
        const session = sessionResult.data.session;
        alert("📦 Session result: " + (session ? "Found" : "Missing"));
        
        if (!session) {
          document.body.innerHTML = "<h1>Session not found. Please log in again.</h1>";
          return;
        }
        
        const user = session.user;
        const isAdmin =
          user.email === 'fvinsuranceagency@gmail.com' ||
          user.email === 'johnsondemesi@gmail.com';
          alert("👤 Logged in as: " + user.email + "\nAdmin? " + isAdmin);
          
          // Show/hide admin features
          document.querySelectorAll('.admin-only').forEach(el => {
            el.style.display = isAdmin ? 'inline' : 'none';
        });
        
        // Hide loading screen
        if (loadingScreen) {
          alert("🧹 Hiding loading screen...");
          loadingScreen.style.display = 'none';
          loadingScreen.style.visibility = 'hidden';
          loadingScreen.style.opacity = '0';
          loadingScreen.style.zIndex = '-1';
        }
        
        // Show default tabi
        alert("📑 Hiding all tabs and showing default...");
        document.querySelectorAll('.tab-content').forEach(tab => tab.style.display = 'none');
        const defaultTab = document.getElementById('profile-tab');
        if (defaultTab) defaultTab.style.display = 'block';
        alert("✅ Dashboard setup done.");
        
        // ✅ Fix tab switching
        document.querySelectorAll('nav a[data-tab]').forEach(link => {
          link.addEventListener('click', e => {
            e.preventDefault();
            document.querySelectorAll('.tab-content').forEach(tab => tab.style.display = 'none');
            document.querySelectorAll('nav a').forEach(link => link.classList.remove('active'));
            const tabId = link.getAttribute('data-tab');
            const tab = document.getElementById(tabId);
            if (tab) tab.style.display = 'block';
            link.classList.add('active');
          });
        });
        
        document.querySelectorAll('#admin-filters input, #admin-filters select').forEach(el => {
          el.addEventListener('change', loadLeadsWithFilters);
        });
        
        // ✅ Load agents and leads
        await loadAgentsForAdmin();
        await loadLeadsWithFilters();
        await loadRequestedLeads();
        await loadAssignmentHistory();
      } catch (err) {
        if (loadingScreen) loadingScreen.style.display = 'none';
        document.body.innerHTML = "<h1>Error checking session. Please log in again.</h1>";
        alert("❌ Exception caught: " + err.message);
        console.error(err);
      }
      document.getElementById('lead-form').addEventListener('submit', async (e) => {
        e.preventDefault();
        alert("🚨 Submit button clicked");
        
        try {
          const firstName = document.getElementById('lead-first').value.trim();
          const lastName = document.getElementById('lead-last').value.trim();
          const age = parseInt(document.getElementById('lead-age').value);
          const address = document.getElementById('lead-address').value.trim();
          const city = document.getElementById('lead-city').value.trim();
          const state = document.getElementById('lead-state').value; // changed for <select>
          const zip = document.getElementById('lead-zip').value.trim();
          const notes = document.getElementById('lead-notes').value.trim();
          const type = document.getElementById('lead-type').value;
          const phoneInputs = document.querySelectorAll('#phone-inputs input[name="lead-phone"]');
          const phones = Array.from(phoneInputs)
            .map(input => input.value.trim())
            .filter(num => num.length > 0);
          const { data: { session }, error: sessionError } = await supabase.auth.getSession();
          const userId = session?.user?.id;
          
          if (!userId) {
            alert('❌ Not logged in.');
            return;
          }
          
          const { error } = await supabase.from('leads').insert({
            first_name: firstName,
            last_name: lastName,
            age,
            address,
            city,
            state,
            zip,
            phone: phones,
            notes,
            lead_type: type,
            submitted_by: userId,
            assigned_to: userId,
            assigned_at: new Date().toISOString()
          });
          
          if (error) {
            alert('❌ Supabase insert error: ' + error.message);
          } else {
            alert('✅ Lead submitted successfully!');
            document.getElementById('lead-form').reset();
          }
        } catch (err) {
          alert('❌ JS Error: ' + err.message);
          console.error(err);
        }
      });
      document.getElementById('lead-request-form').addEventListener('submit', async (e) => {
        e.preventDefault();
        alert("📨 Request Leads form submitted");
        const city = document.getElementById('request-city').value.trim();
        const zip = document.getElementById('request-zip').value.trim();
        const type = document.getElementById('request-type').value;
        const count = parseInt(document.getElementById('request-count').value);
        const notes = document.getElementById('request-notes').value.trim();
        const state = document.getElementById('request-state').value;
        const { data: { session } } = await supabase.auth.getSession();
        const userId = session?.user?.id;
        
        if (!userId) {
          alert('❌ Not logged in.');
          return;
        }
        
        // 🔍 Get full name from agents table
        const { data: agentData, error: agentErr } = await supabase
          .from('agents')
          .select('full_name')
          .eq('id', userId)
          .single(); 
        const fullName = agentData?.full_name || 'Unknown';
        const { error } = await supabase.from('lead_requests').insert({
          submitted_by: userId,
          submitted_by_name: fullName,
          city,
          state,
          zip,
          lead_type: type,
          requested_count: count,
          notes
        });
        
        if (error) {
          alert('❌ Failed to submit request: ' + error.message);
        } else {
          alert('✅ Request submitted!');
          document.getElementById('lead-request-form').reset();
        }
      });
      document.getElementById('phone-inputs').addEventListener('click', (e) => {
        
        // ADD PHONE
        if (e.target && e.target.classList.contains('add-phone-btn')) {
          const newLine = document.createElement('div');
          newLine.className = 'phone-line';
          newLine.innerHTML = `
            <input type="tel" name="lead-phone" placeholder="(123) 456-7890" maxlength="14" required />
            <button type="button" class="remove-phone-btn">−</button>
            `;
          document.getElementById('phone-inputs').appendChild(newLine);
        }
        
        // REMOVE PHONE
        if (e.target && e.target.classList.contains('remove-phone-btn')) {
          e.target.parentElement.remove();
        }
      });
      
      // 📞 Auto-format phone number fields as (123) 456-7890
      document.addEventListener('input', (e) => {
        if (e.target.name === 'lead-phone') {
          let input = e.target.value.replace(/\D/g, '').slice(0, 10);
          if (input.length >= 6) {
            e.target.value = `(${input.slice(0,3)}) ${input.slice(3,6)}-${input.slice(6)}`;
          } else if (input.length >= 3) {
            e.target.value = `(${input.slice(0,3)}) ${input.slice(3)}`;
          } else {
            e.target.value = input;
          }
        }
      });
      
      async function loadRequestedLeads() {
        const container = document.getElementById('requested-leads-container');
        container.innerHTML = 'Loading...';
        const { data, error } = await supabase
          .from('lead_requests')
          .select('*')
          .order('created_at', { ascending: false });
        
        if (error) {
          console.error('Error loading requests:', error);
          container.innerHTML = '<p>Error loading requests.</p>';
          return;
        }
        
        const html = data.map(req => `
          <div class="lead-request-box" data-request-id="${req.id}">
          <strong>Requested By:</strong> ${req.submitted_by_name || 'Unknown'}<br>
          <strong>City:</strong> ${req.city || 'N/A'}<br>
          <strong>ZIP:</strong> ${req.zip || 'N/A'}<br>
          <strong>State:</strong> ${req.state || 'N/A'}<br>
          <strong>Lead Type:</strong> ${req.lead_type || 'N/A'}<br>
          <strong>How many:</strong> ${req.requested_count || 'N/A'}<br>
          <strong>Notes:</strong> ${req.notes || 'None'}<br>
          <em>Submitted: ${new Date(req.created_at).toLocaleString()}</em><br>
          <button class="delete-request-btn">Delete</button>
          <hr>
          </div>
        `).join('');
        
        container.innerHTML = html || '<p>No lead requests found.</p>';
        
        document.querySelectorAll('.delete-request-btn').forEach(btn => {
          btn.addEventListener('click', async (e) => {
            const parentBox = e.target.closest('.lead-request-box');
            const requestId = parentBox.getAttribute('data-request-id');
            const confirmed = confirm('Are you sure you want to delete this request?');
            
            if (!confirmed) return;
            
            const { error } = await supabase.from('lead_requests').delete().eq('id', requestId);
            
            if (error) {
              alert('❌ Failed to delete request.');
              console.error(error);
            } else {
              parentBox.remove();
              alert('✅ Request deleted.');
            }
          });
        });
      }
      new Choices('#request-state', {
        removeItemButton: false,
        searchEnabled: true,
        placeholder: true,
        shouldSort: false,
      });
      // 📍 All 50 U.S. States
      const usStates = [
      "AL","AK","AZ","AR","CA","CO","CT","DE","FL","GA","HI","ID","IL","IN","IA","KS","KY",
      "LA","ME","MD","MA","MI","MN","MS","MO","MT","NE","NV","NH","NJ","NM","NY","NC","ND",
      "OH","OK","OR","PA","RI","SC","SD","TN","TX","UT","VT","VA","WA","WV","WI","WY"
      ];
      const stateSelect = document.getElementById('lead-state');
      
      usStates.forEach(state => {
        const option = document.createElement('option');
        option.value = state;
        option.textContent = state;
        stateSelect.appendChild(option);
      });
      
      // 🎯 Make it a Choices.js dropdown
      new Choices('#lead-state', { searchEnabled: true, itemSelectText: '' });
      
      // 🟩 Apply Filters Button
      document.getElementById('apply-filters').addEventListener('click', () => {
        loadLeadsWithFilters();
      });
      
      // 🟥 Reset Filters Button
      document.getElementById('reset-filters').addEventListener('click', () => {
        document.querySelectorAll('#admin-filters input, #admin-filters select').forEach(el => {
          if (el.tagName === 'SELECT') el.selectedIndex = 0;
          else el.value = '';
        });
        loadLeadsWithFilters();
      });
      let currentSortColumn = null;
      let currentSortDirection = 'asc';
      
      document.querySelectorAll('#leads-table th[data-column]').forEach(th => {
        th.addEventListener('click', () => {
          const column = th.getAttribute('data-column');
          
          if (currentSortColumn === column) {
            currentSortDirection = currentSortDirection === 'asc' ? 'desc' : 'asc';
          } else {
            currentSortColumn = column;
            currentSortDirection = 'asc';
          }
          
          document.getElementById('sort-by').value = column;
          document.getElementById('date-order').value = currentSortDirection;
          loadLeadsWithFilters();
        });
      });
    });
    
    let allAgents = [];
    let selectedLeads = new Set();
    let currentPage = 1;
    const PAGE_SIZE = 25;
    let rangeStart = null;
    let rangeEnd = null;
    
    flatpickr("#date-range", {
      mode: "range",
      dateFormat: "Y-m-d",
      onChange: function(selectedDates) {
        rangeStart = selectedDates[0] ? selectedDates[0].toISOString().split('T')[0] : null;
        rangeEnd = selectedDates[1] ? selectedDates[1].toISOString().split('T')[0] : null;
        loadLeadsWithFilters();
      }
    });
    
    async function loadAgentsForAdmin() {
      const { data, error } = await supabase.from('agents').select('id, full_name').eq('is_active', true);
      if (!error && data) {
        allAgents = data;
        const dropdowns = [
          { el: document.getElementById('agent-filter'), placeholder: 'All Agents' },
          { el: document.getElementById('bulk-assign-agent'), placeholder: 'Select Agent' }
        ];
        
        dropdowns.forEach(({ el, placeholder }) => {
          el.innerHTML = `<option value="">${placeholder}</option>`;
          data.forEach(agent => {
            const opt = document.createElement('option');
            opt.value = agent.id;
            opt.textContent = agent.full_name;
            el.appendChild(opt);
          });
          
          new Choices(el, {
            shouldSort: false,
            searchEnabled: true,
            placeholder: true,
            itemSelectText: '',
          });
        });
      }
    }
    new Choices('#state-filter', { searchEnabled: true, itemSelectText: '' });
    
    document.getElementById('bulk-assign-agent').addEventListener('change', (e) => {
      //alert("🔄 Agent selected: " + e.target.value);
    });
    
    async function loadLeadsWithFilters() {
      const tbody = document.querySelector('#leads-table tbody');
      tbody.innerHTML = '';
      const order = document.getElementById('date-order').value;
      const sortBy = document.getElementById('sort-by')?.value || 'created_at';
      const agent = document.getElementById('agent-filter').value;
      const zip = document.getElementById('zip-filter').value;
      const city = document.getElementById('city-filter').value;
      const state = document.getElementById('state-filter').value;
      const first = document.getElementById('first-name-filter').value;
      const last = document.getElementById('last-name-filter').value;
      const type = document.getElementById('lead-type-filter').value;
      const assignedFilter = document.getElementById('assigned-filter').value;
      
      let query = supabase.from('leads').select('*', { count: 'exact' });
      
      if (rangeStart) query = query.gte('created_at', rangeStart);
      if (rangeEnd) query = query.lte('created_at', rangeEnd);
      if (agent) query = query.eq('assigned_to', agent);
      if (zip) query = query.ilike('zip', `%${zip}%`);
      if (city) query = query.ilike('city', `%${city}%`);
      if (state) query = query.ilike('state', `%${state}%`);
      if (first) query = query.ilike('first_name', `%${first}%`);
      if (last) query = query.ilike('last_name', `%${last}%`);
      if (type) query = query.ilike('lead_type', `%${type}%`);
      if (assignedFilter === 'true') query = query.not('assigned_to', 'is', null);
      if (assignedFilter === 'false') query = query.is('assigned_to', null);
      
      const from = (currentPage - 1) * PAGE_SIZE;
      const to = from + PAGE_SIZE - 1;
      const sortBy = document.getElementById('sort-by').value || 'created_at';
      const { data: leads, error, count } = await query
        .order(sortBy, { ascending: order === 'asc' })
        .range(from, to);
      
      if (error) return console.error('Error loading leads:', error);
      
      const totalPages = Math.ceil(count / PAGE_SIZE);
      document.getElementById('current-page').textContent = `Page ${currentPage} of ${totalPages}`;
      document.getElementById('prev-page').disabled = currentPage === 1;
      document.getElementById('next-page').disabled = currentPage >= totalPages;
      
      leads.forEach(lead => {
        const tr = document.createElement('tr');
        const checkboxTd = document.createElement('td');
        const checkbox = document.createElement('input');
        checkbox.type = 'checkbox';
        checkbox.dataset.leadId = lead.id;
        
        checkbox.addEventListener('change', (e) => {
          if (e.target.checked) {
            selectedLeads.add(lead.id);
          } else {
            selectedLeads.delete(lead.id);
          }
          document.getElementById('selected-count').textContent = selectedLeads.size;
          document.getElementById('bulk-assign-controls').style.display = selectedLeads.size > 0 ? 'block' : 'none';
        });
        
        checkboxTd.appendChild(checkbox);
        tr.appendChild(checkboxTd);
        
        const agentName = allAgents.find(a => a.id === lead.assigned_to)?.full_name || 'Unassigned';
        const cells = [
          new Date(lead.created_at).toLocaleDateString(),
          agentName,
          lead.first_name || '',
          lead.last_name || '',
          lead.age || '',
          (lead.phone || []).join(', '),
          lead.address || '',
          lead.city || '',
          lead.state || '',
          lead.zip || '',
          lead.lead_type || '',
          lead.notes || ''
        ];
        
        cells.forEach(text => {
          const td = document.createElement('td');
          td.textContent = text;
          tr.appendChild(td);
        });
        
        tbody.appendChild(tr);
      });
    }
    
    // Assign button handler
    document.getElementById('bulk-assign-btn').addEventListener('click', async () => {
      //alert("🟡 Assign button clicked");
      const selected = [...selectedLeads];
      if (selected.length === 0) {
        alert("⚠️ No leads selected");
        return;
      }
      
      const reassigned = selected.some(id =>
        document.querySelector(`input[data-lead-id="${id}"]`)
          .closest('tr')
          .querySelector('td:nth-child(2)').textContent !== 'Unassigned'
      );
      
      if (reassigned) {
        //alert("⚠️ Some leads are already assigned");
        document.getElementById('reassign-warning-modal').style.display = 'block';
      } else {
        const agentId = document.getElementById('bulk-assign-agent').value;
        if (!agentId) { 
          alert("⚠️ No agent selected");
          return;
        }
        alert("✅ Assigning leads to: " + agentId);
        await assignLeads(agentId);
      }
    });
    
    // Assign leads function
    async function assignLeads(agentId) {
      //alert("🚀 Starting assignLeads with agentId: " + agentId);
      const updates = Array.from(selectedLeads).map(leadId => ({
        id: leadId,
        assigned_to: agentId,
        assigned_at: new Date().toISOString()
      }));
      
      for (const update of updates) {
        const { error } = await supabase
          .from('leads')
          .update({
            assigned_to: update.assigned_to,
            assigned_at: update.assigned_at
          })
            .eq('id', update.id);
        
        if (error) {
          alert(`❌ Failed to assign lead ${update.id}: ${error.message}`);
        return;
        }
      }
      
      selectedLeads.clear();
      document.getElementById('selected-count').textContent = '0';
      document.getElementById('bulk-assign-controls').style.display = 'none';
      document.getElementById('reassign-warning-modal').style.display = 'none';

      await loadLeadsWithFilters();
      await loadAssignmentHistory();
    }
    document.getElementById('prev-page').addEventListener('click', () => {
      if (currentPage > 1) {
        currentPage--;
        loadLeadsWithFilters();
      }
    });
    
    document.getElementById('next-page').addEventListener('click', () => {
      currentPage++;
      loadLeadsWithFilters();
    });
    
    document.getElementById('submit-anyway-btn').addEventListener('click', () => {
      const agentId = document.getElementById('bulk-assign-agent').value;
      assignLeads(agentId);
    });
    
    document.getElementById('cancel-reassign-btn').addEventListener('click', () => {
      document.getElementById('reassign-warning-modal').style.display = 'none';
    });
    
    async function loadAssignmentHistory() {
      const tbody = document.querySelector('#assignment-history-table tbody');
      tbody.innerHTML = '';
      const { data, error } = await supabase
        .from('assignment_history')
        .select(`
          id,
          assigned_at,
          lead_id,
          assigned_to,
          assigned_by,
          profiles_assigned_to:assigned_to ( full_name ),
          profiles_assigned_by:assigned_by ( full_name )
        `)
        .order('assigned_at', { ascending: false })
        .limit(25);
      
      if (error) {
        console.error("Failed to load assignment history", error);
        return;
      }
      
      data.forEach(row => {
        const tr = document.createElement('tr');
        const cells = [
          new Date(row.assigned_at).toLocaleString(),
          row.lead_id,
          row.profiles_assigned_to?.full_name || row.assigned_to,
          row.profiles_assigned_by?.full_name || row.assigned_by
        ];
        
        cells.forEach(text => {
          const td = document.createElement('td');
          td.textContent = text;
          tr.appendChild(td);
        });
        
        tbody.appendChild(tr);
      });
    }
