-- LND Mar26 MD stock, part 2: main products show the whole set.
-- The regrouping gave each new main product its first option's photo (one
-- character). These are the order list's photos of the same products, which
-- show all the characters. Options keep their own character photos.
begin;
update public.stock_items s set image = v.image
  from (values
    ('b2296a01-de66-4903-bbe1-85a906f7bcd1'::uuid, 'https://i.postimg.cc/wvLPpVHk/image.png'), -- แฟ้มคดี
    ('52e814ce-4e19-4088-bec6-a948fe9b4227'::uuid, 'https://i.postimg.cc/t4sBb5Nt/image.png'), -- เข็มกลัด
    ('9dd26d86-c271-4c6e-88e4-d2773dd56816'::uuid, 'https://i.postimg.cc/1XWKhngY/image.png'), -- เซ็ตรูปฟิล์ม
    ('5085f9a1-dcda-465b-9696-d73844275fa2'::uuid, 'https://i.postimg.cc/2j4RRzSj/image.png'), -- โฟโต้การ์ด
    ('adfcecd8-1987-467e-913b-7f36bbeb6a15'::uuid, 'https://i.postimg.cc/X7mwf09b/image.png'), -- เข็มกลัด S
    ('cd45ce32-d4fc-4dd8-ad14-85e3cb99a161'::uuid, 'https://i.postimg.cc/wBZ8HMmG/image.png'), -- สแตนดี้ R
    ('294b352d-023d-4659-b406-0c5e153348d8'::uuid, 'https://i.postimg.cc/bNDnNF4r/image.png'), -- สแตนดี้ B
    ('e3574d17-22aa-4681-ad59-6c0efc78a1c9'::uuid, 'https://i.postimg.cc/B6SDSZGW/image.png'), -- เข็มกลัด B
    ('8d5869b9-4d27-4333-8a6a-b8120bcbf2d5'::uuid, 'https://i.postimg.cc/CMtZts5C/image.png'), -- ภาพฉาก B
    ('83286c66-4c00-414f-bc14-71993c43ce77'::uuid, 'https://i.postimg.cc/43CqFqR3/image.png')  -- เซ็ตช้อน+ตะเกียบ
  ) as v(id, image)
 where s.id = v.id and s.parent_id is null;
commit;
