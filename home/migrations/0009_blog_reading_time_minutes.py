from django.db import migrations, models


class Migration(migrations.Migration):
    dependencies = [
        ("home", "0008_add_project_thumbnail_img"),
    ]

    operations = [
        migrations.AddField(
            model_name="blog",
            name="reading_time_minutes",
            field=models.PositiveSmallIntegerField(default=1, editable=False),
        ),
    ]
