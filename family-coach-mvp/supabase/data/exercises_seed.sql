insert into public.exercises (name, description, image_url) values
  ('Joint mobility flow','Gentle sequence for neck, shoulders, hips and ankles to increase range of motion. 5 minutes, no equipment.','https://images.unsplash.com/photo-1556817411-31ae72fa3ea0?w=1200&q=80'),
  ('Glute bridges','Lie on back, knees bent. Drive through heels to lift hips, squeeze glutes. Control down.','https://images.unsplash.com/photo-1599058917212-d750089bc07e?w=1200&q=80')
on conflict (name) do update set description=excluded.description, image_url=excluded.image_url;
