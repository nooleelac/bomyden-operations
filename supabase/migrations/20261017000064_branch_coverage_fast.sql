-- =====================================================================
-- TĂNG TỐC branch_coverage (17/10/2026)
-- =====================================================================
-- Bản cũ chạy 3 truy vấn con cho MỖI ô (ngày × khung giờ): xem cả tháng
-- = ~1.000 ô × 3 ≈ 3.000 truy vấn con (~300 ms).
-- Bản mới đọc nhu cầu / ca / đăng ký của chi nhánh MỘT lần (đổi sẵn ra phút; "materialized"
-- vì private.tod_minutes có set search_path nên không inline được, gọi lại mỗi ô rất tốn),
-- rồi ghép với lưới ô bằng join + group by. Kết quả giữ nguyên từng giá trị.
-- =====================================================================

create or replace function public.branch_coverage(p_branch_id uuid, p_from date, p_to date)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  s      public.schedule_settings;
  v_e    integer;
  v_l    integer;
  v_step integer;
begin
  if not (private.manages_branch(p_branch_id) or private.in_my_branch(p_branch_id)) then
    raise exception 'Bạn không có quyền xem chi nhánh này.' using errcode = '42501';
  end if;
  if p_from is null or p_to is null or p_to < p_from or p_to - p_from > 62 then
    raise exception 'Khoảng ngày không hợp lệ (tối đa 2 tháng).' using errcode = 'P0001';
  end if;
  s := private.branch_register_settings(p_branch_id);
  v_e := private.tod_minutes(s.register_earliest);
  v_l := private.register_window_end(s);
  v_step := s.register_step_minutes;

  return jsonb_build_object(
    'start', v_e,
    'step', v_step,
    'days', coalesce((
      with cells as (
        select g::date as d, t
        from generate_series(p_from, p_to, interval '1 day') g
        cross join generate_series(v_e, v_l - v_step, v_step) t
      ),
      req as materialized (
        select q.weekdays, q.headcount, qq.qs, qq.qs + private.time_span_minutes(q.start_time, q.end_time) as qe
        from public.staffing_requirements q
        cross join lateral (
          select private.tod_minutes(q.start_time)
            + case when private.tod_minutes(q.start_time) < v_e then 1440 else 0 end as qs
        ) qq
        where q.branch_id = p_branch_id
      ),
      sh as materialized (
        select x.work_date as d, private.tod_minutes(x.start_time) as xs,
               private.tod_minutes(x.start_time) + private.time_span_minutes(x.start_time, x.end_time) as xe
        from public.shifts x
        where x.branch_id = p_branch_id and x.work_date between p_from and p_to and x.status <> 'cancelled'
      ),
      rg as materialized (
        select g.work_date as d, private.tod_minutes(g.start_time) as gs,
               private.tod_minutes(g.start_time) + private.time_span_minutes(g.start_time, g.end_time) as ge
        from public.shift_registrations g
        where g.branch_id = p_branch_id and g.work_date between p_from and p_to
          and g.status = 'pending' and g.start_time is not null
      ),
      need as (
        select c.d, c.t, max(r.headcount) as n
        from cells c
        join req r on extract(dow from c.d)::smallint = any (r.weekdays) and r.qs <= c.t and r.qe >= c.t + v_step
        group by c.d, c.t
      ),
      sched as (
        select c.d, c.t, count(*) as n
        from cells c
        join sh on sh.d = c.d and sh.xs < c.t + v_step and sh.xe > c.t
        group by c.d, c.t
      ),
      pend as (
        select c.d, c.t, count(*) as n
        from cells c
        join rg on rg.d = c.d and rg.gs < c.t + v_step and rg.ge > c.t
        group by c.d, c.t
      )
      select jsonb_agg(jsonb_build_object('date', z.d, 'need', z.need, 'scheduled', z.sched, 'pending', z.pend) order by z.d)
      from (
        select c.d,
               array_agg(coalesce(nd.n, 0) order by c.t) as need,
               array_agg(coalesce(sc.n, 0) order by c.t) as sched,
               array_agg(coalesce(pd.n, 0) order by c.t) as pend
        from cells c
        left join need nd on nd.d = c.d and nd.t = c.t
        left join sched sc on sc.d = c.d and sc.t = c.t
        left join pend pd on pd.d = c.d and pd.t = c.t
        group by c.d
      ) z
    ), '[]'::jsonb)
  );
end;
$$;

revoke all on function public.branch_coverage(uuid, date, date) from public, anon;
grant execute on function public.branch_coverage(uuid, date, date) to authenticated;
