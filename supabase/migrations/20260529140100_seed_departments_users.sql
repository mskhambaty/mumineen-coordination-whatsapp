-- Seed data: departments and known users

-- Insert all departments
insert into public.departments (name) values
  ('Accommodation'),
  ('AVR'),
  ('Communication'),
  ('Finance & Procurement'),
  ('Fire Safety'),
  ('Flow Management'),
  ('HR'),
  ('IT'),
  ('ITS'),
  ('Follow-up'),
  ('Mawaid'),
  ('Medical'),
  ('Mumineen Reception'),
  ('Nazafat/Venue Preparation'),
  ('Online Niyaz Araz'),
  ('Photography'),
  ('PR'),
  ('Project Management'),
  ('Qardan Hasana/Najwa Shukr'),
  ('Rahat Support'),
  ('Sabeel'),
  ('Scanning'),
  ('Security'),
  ('Site/Construction'),
  ('Tazyeen & Signages'),
  ('TNC'),
  ('Istibsaar'),
  ('Hifz'),
  ('Translations'),
  ('Transport'),
  ('Waaz Talaqqi'),
  ('Zakereen'),
  ('Karamat')
on conflict (name) do nothing;

-- Insert known users
insert into public.whatsapp_users (phone_e164, display_name, email, global_role, role, status, transcript_aliases)
values
  ('+13128749178', 'Moiz Broachwala', 'moizbroachwala@gmail.com', 'member', 'committee', 'active', ARRAY['Moiz Broachwala']),
  ('+10000000001', 'Shabbir Karimi', 'shabbir.karimi@gmail.com', 'member', 'committee', 'active', ARRAY['Shabbir Karimi']),
  ('+10000000002', 'Huzefa Master', 'huzefa.master@gmail.com', 'member', 'committee', 'active', ARRAY['Huzefa Master']),
  ('+10000000003', 'Usuf Hussain', 'usuf.husain@gmail.com', 'member', 'committee', 'active', ARRAY['Usuf Hussain']),
  ('+10000000004', 'Mariam Ezzy', 'mariamalicpa@gmail.com', 'member', 'committee', 'active', ARRAY['Mariam Ezzy']),
  ('+10000000005', 'Ameer Gomberawalla', 'ameergombera@gmail.com', 'member', 'committee', 'active', ARRAY['Ameer Gomberawalla']),
  ('+16513435591', 'Mustafa Poonawala', 'mp4kaplan@yahoo.com', 'member', 'committee', 'active', ARRAY['Mustafa Poonawala']),
  ('+10000000007', 'Ibrahim BS Vajihi', 'ibrahim@mustaly.com', 'member', 'committee', 'active', ARRAY['Ibrahim BS Vajihi']),
  ('+10000000008', 'Hussain Ezzy', null, 'member', 'committee', 'active', ARRAY['Hussain Ezzy']),
  ('+10000000009', 'Ibrahim Alqamari', 'alqamari@gmail.com', 'member', 'committee', 'active', ARRAY['Ibrahim Alqamari']),
  ('+10000000010', 'Mufaddal Gadly', 'muffi.gadly52@gmail.com', 'member', 'committee', 'active', ARRAY['Mufaddal Gadly']),
  ('+17083699695', 'Mufadal Moosabhoy', 'laddafum@gmail.com', 'member', 'committee', 'active', ARRAY['Mufadal Moosabhoy']),
  ('+10000000012', 'Mufaddal Painter', null, 'member', 'committee', 'active', ARRAY['Mufaddal Painter']),
  ('+10000000013', 'Abbas Alqamari', 'aqamari@gmail.com', 'member', 'committee', 'active', ARRAY['Abbas Alqamari']),
  ('+10000000014', 'Taha Tayeb', 'asif.tayeb@gmail.com', 'member', 'committee', 'active', ARRAY['Taha Tayeb']),
  ('+10000000015', 'Hussain Koita', 'hkoita@gmail.com', 'member', 'committee', 'active', ARRAY['Hussain Koita']),
  ('+10000000016', 'Huzefa Gulamhusein', 'huzefa52@gmail.com', 'member', 'committee', 'active', ARRAY['Huzefa Gulamhusein']),
  ('+10000000017', 'Rashida Dahodwala', 'rashdahod@gmail.com', 'member', 'committee', 'active', ARRAY['Rashida Dahodwala']),
  ('+10000000018', 'Mustafa Munaim', 'munaim.mustafa@gmail.com', 'member', 'committee', 'active', ARRAY['Mustafa Munaim']),
  ('+10000000019', 'Husain Presswala', null, 'member', 'committee', 'active', ARRAY['Husain Presswala']),
  ('+10000000020', 'Mufaddal Khambaty', 'mskhambaty@gmail.com', 'leadership_admin', 'admin', 'active', ARRAY['Mufaddal Khambaty'])
on conflict (phone_e164) do nothing;

-- Link users to departments via department_members
-- Moiz Broachwala → PM of Project Management
insert into public.department_members (department_id, user_id, dept_role)
select d.id, u.id, 'pm'
from public.departments d, public.whatsapp_users u
where d.name = 'Project Management' and u.email = 'moizbroachwala@gmail.com'
on conflict (department_id, user_id) do nothing;

-- Shabbir Karimi → HOD of Project Management
insert into public.department_members (department_id, user_id, dept_role)
select d.id, u.id, 'hod'
from public.departments d, public.whatsapp_users u
where d.name = 'Project Management' and u.email = 'shabbir.karimi@gmail.com'
on conflict (department_id, user_id) do nothing;

-- Huzefa Master → HOD of Accommodation
insert into public.department_members (department_id, user_id, dept_role)
select d.id, u.id, 'hod'
from public.departments d, public.whatsapp_users u
where d.name = 'Accommodation' and u.email = 'huzefa.master@gmail.com'
on conflict (department_id, user_id) do nothing;

-- Usuf Hussain → HOD of AVR
insert into public.department_members (department_id, user_id, dept_role)
select d.id, u.id, 'hod'
from public.departments d, public.whatsapp_users u
where d.name = 'AVR' and u.email = 'usuf.husain@gmail.com'
on conflict (department_id, user_id) do nothing;

-- Mariam Ezzy → HOD of Finance & Procurement
insert into public.department_members (department_id, user_id, dept_role)
select d.id, u.id, 'hod'
from public.departments d, public.whatsapp_users u
where d.name = 'Finance & Procurement' and u.email = 'mariamalicpa@gmail.com'
on conflict (department_id, user_id) do nothing;

-- Ameer Gomberawalla → HOD of Flow Management
insert into public.department_members (department_id, user_id, dept_role)
select d.id, u.id, 'hod'
from public.departments d, public.whatsapp_users u
where d.name = 'Flow Management' and u.email = 'ameergombera@gmail.com'
on conflict (department_id, user_id) do nothing;

-- Mustafa Poonawala → HOD of HR
insert into public.department_members (department_id, user_id, dept_role)
select d.id, u.id, 'hod'
from public.departments d, public.whatsapp_users u
where d.name = 'HR' and u.email = 'mp4kaplan@yahoo.com'
on conflict (department_id, user_id) do nothing;

-- Ibrahim BS Vajihi → HOD of Follow-up and Scanning
insert into public.department_members (department_id, user_id, dept_role)
select d.id, u.id, 'hod'
from public.departments d, public.whatsapp_users u
where d.name = 'Follow-up' and u.email = 'ibrahim@mustaly.com'
on conflict (department_id, user_id) do nothing;

insert into public.department_members (department_id, user_id, dept_role)
select d.id, u.id, 'hod'
from public.departments d, public.whatsapp_users u
where d.name = 'Scanning' and u.email = 'ibrahim@mustaly.com'
on conflict (department_id, user_id) do nothing;

-- Hussain Ezzy → HOD of Follow-up
insert into public.department_members (department_id, user_id, dept_role)
select d.id, u.id, 'hod'
from public.departments d, public.whatsapp_users u
where d.name = 'Follow-up' and u.display_name = 'Hussain Ezzy'
on conflict (department_id, user_id) do nothing;

-- Ibrahim Alqamari → HOD of Mawaid
insert into public.department_members (department_id, user_id, dept_role)
select d.id, u.id, 'hod'
from public.departments d, public.whatsapp_users u
where d.name = 'Mawaid' and u.email = 'alqamari@gmail.com'
on conflict (department_id, user_id) do nothing;

-- Mufaddal Gadly → PM of Mawaid and Sabeel
insert into public.department_members (department_id, user_id, dept_role)
select d.id, u.id, 'pm'
from public.departments d, public.whatsapp_users u
where d.name = 'Mawaid' and u.email = 'muffi.gadly52@gmail.com'
on conflict (department_id, user_id) do nothing;

insert into public.department_members (department_id, user_id, dept_role)
select d.id, u.id, 'pm'
from public.departments d, public.whatsapp_users u
where d.name = 'Sabeel' and u.email = 'muffi.gadly52@gmail.com'
on conflict (department_id, user_id) do nothing;

-- Mufadal Moosabhoy → HOD of Medical
insert into public.department_members (department_id, user_id, dept_role)
select d.id, u.id, 'hod'
from public.departments d, public.whatsapp_users u
where d.name = 'Medical' and u.email = 'laddafum@gmail.com'
on conflict (department_id, user_id) do nothing;

-- Mufaddal Painter → HOD of Flow Management and Transport
insert into public.department_members (department_id, user_id, dept_role)
select d.id, u.id, 'hod'
from public.departments d, public.whatsapp_users u
where d.name = 'Flow Management' and u.display_name = 'Mufaddal Painter'
on conflict (department_id, user_id) do nothing;

insert into public.department_members (department_id, user_id, dept_role)
select d.id, u.id, 'hod'
from public.departments d, public.whatsapp_users u
where d.name = 'Transport' and u.display_name = 'Mufaddal Painter'
on conflict (department_id, user_id) do nothing;

-- Abbas Alqamari → HOD of Transport
insert into public.department_members (department_id, user_id, dept_role)
select d.id, u.id, 'hod'
from public.departments d, public.whatsapp_users u
where d.name = 'Transport' and u.email = 'aqamari@gmail.com'
on conflict (department_id, user_id) do nothing;

-- Taha Tayeb → PM of Transport
insert into public.department_members (department_id, user_id, dept_role)
select d.id, u.id, 'pm'
from public.departments d, public.whatsapp_users u
where d.name = 'Transport' and u.email = 'asif.tayeb@gmail.com'
on conflict (department_id, user_id) do nothing;

-- Hussain Koita → HOD of Site/Construction
insert into public.department_members (department_id, user_id, dept_role)
select d.id, u.id, 'hod'
from public.departments d, public.whatsapp_users u
where d.name = 'Site/Construction' and u.email = 'hkoita@gmail.com'
on conflict (department_id, user_id) do nothing;

-- Huzefa Gulamhusein → PM of Site/Construction
insert into public.department_members (department_id, user_id, dept_role)
select d.id, u.id, 'pm'
from public.departments d, public.whatsapp_users u
where d.name = 'Site/Construction' and u.email = 'huzefa52@gmail.com'
on conflict (department_id, user_id) do nothing;

-- Rashida Dahodwala → HOD of PR
insert into public.department_members (department_id, user_id, dept_role)
select d.id, u.id, 'hod'
from public.departments d, public.whatsapp_users u
where d.name = 'PR' and u.email = 'rashdahod@gmail.com'
on conflict (department_id, user_id) do nothing;

-- Mustafa Munaim → HOD + PM of Rahat Support and Scanning
insert into public.department_members (department_id, user_id, dept_role)
select d.id, u.id, 'hod'
from public.departments d, public.whatsapp_users u
where d.name = 'Rahat Support' and u.email = 'munaim.mustafa@gmail.com'
on conflict (department_id, user_id) do nothing;

insert into public.department_members (department_id, user_id, dept_role)
select d.id, u.id, 'pm'
from public.departments d, public.whatsapp_users u
where d.name = 'Scanning' and u.email = 'munaim.mustafa@gmail.com'
on conflict (department_id, user_id) do nothing;

-- Husain Presswala → PM of Scanning
insert into public.department_members (department_id, user_id, dept_role)
select d.id, u.id, 'pm'
from public.departments d, public.whatsapp_users u
where d.name = 'Scanning' and u.display_name = 'Husain Presswala'
on conflict (department_id, user_id) do nothing;
