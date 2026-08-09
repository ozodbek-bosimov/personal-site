from django.db import migrations, models


class Migration(migrations.Migration):
    dependencies = [
        ("home", "0002_aboutme_profile_img_alter_aboutme_profile_image_url"),
    ]

    operations = [
        migrations.AlterField(
            model_name="blog",
            name="meta",
            field=models.CharField(max_length=600),
        ),
    ]
