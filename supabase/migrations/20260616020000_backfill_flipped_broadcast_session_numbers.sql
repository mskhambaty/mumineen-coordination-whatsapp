-- Repair conversation_sessions whose phone_number_id was "flipped" onto the broadcast number.
--
-- Outbound broadcast/template sends used to overwrite a session's phone_number_id with the sending
-- (broadcast) account's number, reclassifying helpline conversations onto the broadcast line — which
-- the main inbox scope then excluded, hiding real escalations. The source is fixed
-- (touchConversationSession.phoneNumberIdOnlyIfNew); this repairs the existing damage.
--
-- Rule: a conversation lives where its INBOUND messages arrive. For sessions currently tagged to the
-- broadcast number, reset phone_number_id to the latest inbound message's number. Sessions whose
-- latest inbound is genuinely on the broadcast number, and pure-broadcast recipients with no inbound
-- at all, are left untouched. Idempotent. The broadcast id is prod-specific; matches nothing
-- elsewhere, so this is a safe no-op in other environments.

update public.conversation_sessions cs
set phone_number_id = sub.latest_inbound_number
from (
  select distinct on (phone_e164)
         phone_e164,
         phone_number_id as latest_inbound_number
  from public.messages
  where direction = 'inbound'
  order by phone_e164, created_at desc
) sub
where cs.phone_e164 = sub.phone_e164
  and cs.phone_number_id = '608521205670333'
  and cs.phone_number_id is distinct from sub.latest_inbound_number;
